/**
 * DISCORD BOT - VECTOR-BASED EDGE DETECTION
 * 
 * Uses vector similarity to find profitable betting patterns
 * by matching current game situations to historical outcomes.
 * 
 * Commands:
 *   !edge [team]  - Vector-based edge analysis
 *   !props [player] - NBA player props
 *   !odds [team]  - Odds comparison
 *   !live [team]  - Live game tracking
 *   !games [sport]- Schedule
 *   !kalshi       - Prediction markets
 */

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');
require('dotenv').config();

const ODDS_API_KEY = process.env.ODDS_API_KEY || process.env.THEODDSAPI_KEY || process.env.ODDSAPIKEY;

/* ============================================================================
   CONFIGURATION
   ============================================================================ */

const ODDS_API_HOST = 'https://api.the-odds-api.com';
const ODDS_API_VERSION = 'v4';

const SPORT_KEYS = {
    'NBA': 'basketball_nba',
    'NFL': 'americanfootball_nfl',
    'MLB': 'baseball_mlb',
    'NHL': 'icehockey_nhl',
    'NCAAB': 'basketball_ncaab',
    'NCAAF': 'americanfootball_ncaaf'
};

const TEAM_TO_SPORT = {
    // NBA
    'BUCKS': 'basketball_nba', 'MILWAUKEE': 'basketball_nba',
    'LAKERS': 'basketball_nba', 'CELTICS': 'basketball_nba', 'BOSTON': 'basketball_nba',
    'WARRIORS': 'basketball_nba', 'GOLDEN STATE': 'basketball_nba',
    '76ERS': 'basketball_nba', 'SIXERS': 'basketball_nba', 'PHILADELPHIA': 'basketball_nba',
    'KINGS': 'basketball_nba', 'SACRAMENTO': 'basketball_nba',
    'HEAT': 'basketball_nba', 'MIAMI': 'basketball_nba',
    'BULLS': 'basketball_nba', 'CHICAGO': 'basketball_nba',
    'KNICKS': 'basketball_nba', 'NETS': 'basketball_nba',
    'SUNS': 'basketball_nba', 'PHOENIX': 'basketball_nba',
    'NUGGETS': 'basketball_nba', 'DENVER': 'basketball_nba',
    'MAVERICKS': 'basketball_nba', 'MAVS': 'basketball_nba', 'DALLAS': 'basketball_nba',
    'THUNDER': 'basketball_nba', 'OKC': 'basketball_nba',
    // NFL
    'CHIEFS': 'americanfootball_nfl', 'KANSAS CITY': 'americanfootball_nfl',
    'EAGLES': 'americanfootball_nfl', 'BILLS': 'americanfootball_nfl',
    'COWBOYS': 'americanfootball_nfl', 'RAVENS': 'americanfootball_nfl',
    '49ERS': 'americanfootball_nfl', 'PACKERS': 'americanfootball_nfl',
    'LIONS': 'americanfootball_nfl', 'BENGALS': 'americanfootball_nfl'
};

const TEAM_ALIASES = {
    'BUCKS': ['MILWAUKEE', 'MIL'], 'LAKERS': ['LOS ANGELES LAKERS', 'LAL'],
    'CELTICS': ['BOSTON', 'BOS'], 'WARRIORS': ['GOLDEN STATE', 'GSW'],
    '76ERS': ['PHILADELPHIA', 'PHI', 'SIXERS'], 'CHIEFS': ['KANSAS CITY', 'KC'],
    'EAGLES': ['PHILADELPHIA', 'PHI'], 'BILLS': ['BUFFALO', 'BUF']
};

const SYSTEM_PROMPT = 'You are a sports betting assistant. Be direct and data-focused.';
const HISTORY_LIMIT = 20;

/* ============================================================================
   CACHING
   ============================================================================ */

const cache = {
    kalshi: { data: null, timestamp: 0 },
    polymarket: { data: null, timestamp: 0 },
    oddsApi: new Map(),
    scores: new Map()
};

const priceHistory = new Map();
const CACHE_TTL = 30 * 1000;

function isCacheValid(entry) {
    return entry && entry.data && (Date.now() - entry.timestamp) < CACHE_TTL;
}

function recordPrice(marketId, price) {
    if (!priceHistory.has(marketId)) priceHistory.set(marketId, []);
    const history = priceHistory.get(marketId);
    history.push({ price, timestamp: Date.now() });
    while (history.length > 100) history.shift();
}

function getPriceMovement(marketId) {
    const history = priceHistory.get(marketId);
    if (!history || history.length < 2) return null;
    const current = history[history.length - 1];
    const oldest = history[0];
    const change = current.price - oldest.price;
    if (Math.abs(change) < 3) return null;
    return { change, direction: change > 0 ? 'up' : 'down' };
}

/* ============================================================================
   CLIENTS
   ============================================================================ */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const conversationHistory = new Map();

/* ============================================================================
   HELPERS
   ============================================================================ */

function getHistory(channelId) {
    if (!conversationHistory.has(channelId)) conversationHistory.set(channelId, []);
    return conversationHistory.get(channelId);
}

function addHistory(channelId, role, content) {
    const h = getHistory(channelId);
    h.push({ role, content });
    if (h.length > HISTORY_LIMIT) h.shift();
}

async function sendResponse(message, response) {
    if (!response || response.length === 0) {
        await message.reply('No response generated.');
        return;
    }
    if (response.length <= 2000) {
        await message.reply(response);
    } else {
        const chunks = response.match(/.{1,1900}/gs) || [];
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) await message.reply(chunks[i]);
            else await message.channel.send(chunks[i]);
        }
    }
}

function centsToAmericanOdds(cents) {
    if (!cents || cents <= 0 || cents >= 100) return null;
    return cents >= 50
        ? Math.round(-(cents / (100 - cents)) * 100)
        : Math.round(((100 - cents) / cents) * 100);
}

function formatOdds(odds) {
    if (odds === null || odds === undefined) return '—';
    return odds > 0 ? `+${odds}` : `${odds}`;
}

function detectSport(query) {
    const terms = query.toUpperCase().split(/\s+/);
    for (const term of terms) {
        if (TEAM_TO_SPORT[term]) return TEAM_TO_SPORT[term];
    }
    return null;
}

function expandTerms(query) {
    const terms = query.toUpperCase().split(/\s+/).filter(t => t.length > 2);
    const expanded = new Set(terms);
    terms.forEach(term => {
        if (TEAM_ALIASES[term]) TEAM_ALIASES[term].forEach(a => expanded.add(a));
    });
    return Array.from(expanded);
}

/* ============================================================================
   VECTOR EDGE SYSTEM
   ============================================================================ */

function getVectorEdges() {
    try {
        const filePath = './vector_edges.json';
        if (!fs.existsSync(filePath)) return [];
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('[Vector] Read error:', error.message);
        return [];
    }
}

function getNbaPropsData() {
    try {
        const filePath = './nba_props_data.json';
        if (!fs.existsSync(filePath)) return [];
        const data = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return [];
    }
}

function updateVectorEdges() {
    console.log('[Vector] Updating edge data...');
    exec('python vector_edge.py', (err, stdout, stderr) => {
        if (err) {
            exec('python3 vector_edge.py', (err2, stdout2) => {
                if (err2) console.error('[Vector] Python error:', err2.message);
                else if (stdout2) console.log(stdout2);
            });
        } else {
            if (stdout) console.log(stdout);
        }
    });
}

function getEdgeEmoji(status) {
    switch (status) {
        case 'STRONG_EDGE': return '🔥';
        case 'MODERATE_EDGE': return '✅';
        case 'WEAK_EDGE': return '⚡';
        case 'NO_EDGE': return '⚖️';
        default: return '❓';
    }
}

function getEdgeColor(status) {
    switch (status) {
        case 'STRONG_EDGE': return 0xFF4500;
        case 'MODERATE_EDGE': return 0x00FF00;
        case 'WEAK_EDGE': return 0xFFAA00;
        default: return 0x99AAB5;
    }
}

/* ============================================================================
   API FUNCTIONS
   ============================================================================ */

async function getKalshiMarkets() {
    if (isCacheValid(cache.kalshi)) return cache.kalshi.data;

    try {
        const res = await axios.get('https://api.elections.kalshi.com/trade-api/v2/markets', {
            params: { limit: 500, status: 'open' },
            timeout: 10000
        });

        const markets = (res.data.markets || []).filter(m => {
            const ticker = (m.ticker || '').toUpperCase();
            if (ticker.includes('MULTIGAME') || ticker.includes('EXTENDED')) return false;
            return true;
        });

        markets.forEach(m => {
            if (m.yes_bid) recordPrice(m.ticker, m.yes_bid);
        });

        cache.kalshi = { data: markets, timestamp: Date.now() };
        return markets;
    } catch (error) {
        console.error('[Kalshi]', error.message);
        return cache.kalshi.data || [];
    }
}

async function getPolymarketEvents() {
    if (isCacheValid(cache.polymarket)) return cache.polymarket.data;

    try {
        const res = await axios.get('https://gamma-api.polymarket.com/events', {
            params: { limit: 100, active: true, closed: false },
            timeout: 10000
        });
        cache.polymarket = { data: res.data || [], timestamp: Date.now() };
        return res.data || [];
    } catch (error) {
        return cache.polymarket.data || [];
    }
}

async function getOddsForSport(sport) {
    if (!ODDS_API_KEY) return [];

    const cached = cache.oddsApi.get(sport);
    if (cached && isCacheValid(cached)) return cached.data;

    try {
        const res = await axios.get(`${ODDS_API_HOST}/${ODDS_API_VERSION}/sports/${sport}/odds`, {
            params: {
                apiKey: ODDS_API_KEY,
                regions: 'us',
                markets: 'h2h,spreads,totals',
                oddsFormat: 'american'
            },
            timeout: 15000
        });
        cache.oddsApi.set(sport, { data: res.data || [], timestamp: Date.now() });
        return res.data || [];
    } catch (error) {
        return cached?.data || [];
    }
}

function searchKalshi(markets, terms) {
    return markets.filter(m => {
        const text = `${m.title || ''} ${m.ticker || ''}`.toUpperCase();
        return terms.some(t => text.includes(t));
    });
}

function searchOddsApi(games, terms) {
    return games.filter(g => {
        const text = `${g.home_team || ''} ${g.away_team || ''}`.toUpperCase();
        return terms.some(t => text.includes(t));
    });
}

/* ============================================================================
   BOT READY
   ============================================================================ */

client.on('ready', () => {
    console.log('');
    console.log('════════════════════════════════════════════════════');
    console.log(`  BOT ONLINE: ${client.user.tag}`);
    console.log(`  ${new Date().toLocaleString()}`);
    console.log('════════════════════════════════════════════════════');
    console.log('  VECTOR EDGE DETECTION ACTIVE');
    console.log(`  ODDS_API_KEY: ${ODDS_API_KEY ? 'SET' : 'MISSING'}`);
    console.log('════════════════════════════════════════════════════');

    // Update vector edges on startup
    updateVectorEdges();
});

/* ============================================================================
   MESSAGE HANDLER
   ============================================================================ */

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();

    // !help
    if (lower === '!help') {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🎰 Vector Edge Bot')
            .setDescription('**Uses vector similarity to find profitable betting patterns**')
            .addFields(
                { name: '🔥 Edge Detection', value: '`!edge` - All edges\n`!edge [team]` - Team edge\n`!props` - NBA props', inline: false },
                { name: '📊 Odds', value: '`!odds [team]` - Compare odds\n`!live [team]` - Live tracking\n`!games [sport]` - Schedule', inline: false },
                { name: '🔮 Markets', value: '`!kalshi [search]` - Prediction markets', inline: false },
                { name: '💬 AI', value: '`!ask [q]` `!clear`', inline: false }
            );
        await message.reply({ embeds: [embed] });
        return;
    }

    // !clear
    if (lower === '!clear') {
        conversationHistory.set(message.channel.id, []);
        await message.reply('🧹 Cleared!');
        return;
    }

    // !edge - Vector-based edge detection
    if (lower.startsWith('!edge')) {
        const query = content.slice(5).trim().toUpperCase();
        const edgeData = getVectorEdges();

        if (edgeData.length === 0) {
            await message.reply('⏳ **Generating edge data...** try again in 30s.\n\n*Vector analysis requires historical pattern matching.*');
            updateVectorEdges();
            return;
        }

        if (query) {
            // Find specific team
            const edge = edgeData.find(e => 
                e.team === query || 
                e.opponent === query ||
                e.team.includes(query) ||
                e.opponent.includes(query)
            );

            if (!edge) {
                const available = edgeData.map(e => `${e.team} vs ${e.opponent}`).join(', ');
                await message.reply(`❌ No edge data for **${query}**\n\nAvailable: ${available}`);
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(getEdgeColor(edge.status))
                .setTitle(`${getEdgeEmoji(edge.status)} ${edge.team} vs ${edge.opponent}`)
                .setDescription(`**Status: ${edge.status}**\nSample Size: ${edge.sample_size} similar games\nAvg Similarity: ${(edge.avg_similarity * 100).toFixed(1)}%`)
                .setFooter({ text: 'Vector similarity matching' });

            if (edge.edges && edge.edges.length > 0) {
                edge.edges.forEach(e => {
                    const confidence = (e.confidence * 100).toFixed(0);
                    embed.addFields({
                        name: `${e.type}: ${e.direction}`,
                        value: `Edge: **${e.edge > 0 ? '+' : ''}${e.edge}%**\nWin Rate: ${e.win_rate}%\nConfidence: ${confidence}%`,
                        inline: true
                    });
                });
            } else {
                embed.addFields({ name: 'No Edge', value: 'Market is efficient for this matchup', inline: false });
            }

            await message.reply({ embeds: [embed] });
            return;
        }

        // Summary of all edges
        const strongEdges = edgeData.filter(e => e.status === 'STRONG_EDGE');
        const moderateEdges = edgeData.filter(e => e.status === 'MODERATE_EDGE');

        const formatEdge = (e) => {
            const topEdge = e.edges && e.edges[0];
            if (!topEdge) return `${e.team} vs ${e.opponent}: No clear edge`;
            return `**${e.team}** vs ${e.opponent}: ${topEdge.type} ${topEdge.direction} (${topEdge.edge > 0 ? '+' : ''}${topEdge.edge}%)`;
        };

        const embed = new EmbedBuilder()
            .setColor(0xFF4500)
            .setTitle('🔥 Vector Edge Report')
            .setDescription('*Pattern matching against historical similar situations*')
            .addFields(
                { 
                    name: '🔥 Strong Edges', 
                    value: strongEdges.length ? strongEdges.map(formatEdge).join('\n') : 'None found', 
                    inline: false 
                },
                { 
                    name: '✅ Moderate Edges', 
                    value: moderateEdges.length ? moderateEdges.map(formatEdge).join('\n') : 'None found', 
                    inline: false 
                }
            )
            .setFooter({ text: '!edge [team] for details' });

        await message.reply({ embeds: [embed] });
        return;
    }

    // !props - NBA player props
    if (lower.startsWith('!props')) {
        const query = content.slice(6).trim().toUpperCase();
        const propsData = getNbaPropsData();

        if (propsData.length === 0) {
            await message.reply('⏳ **No props data available.**\n\nRun `python update_nba_props.py` locally to generate data.');
            return;
        }

        if (query) {
            const player = propsData.find(p => 
                p.player.toUpperCase().includes(query) ||
                query.includes(p.player.split(' ').pop().toUpperCase())
            );

            if (!player) {
                const available = propsData.slice(0, 5).map(p => p.player.split(' ').pop()).join(', ');
                await message.reply(`❌ No data for **${query}**\n\nTry: ${available}...`);
                return;
            }

            let color = 0x99AAB5;
            if (player.status === 'HOT') color = 0xFF4500;
            if (player.status === 'COLD') color = 0x00BFFF;

            const embed = new EmbedBuilder()
                .setColor(color)
                .setTitle(`🏀 ${player.player}`)
                .setDescription(`**${player.team}** | ${player.status === 'HOT' ? '🔥 HOT' : player.status === 'COLD' ? '❄️ COLD' : '⚖️ NEUTRAL'}`)
                .addFields(
                    { name: 'Points', value: `Season: ${player.season_ppg}\nLast 5: ${player.recent_ppg}\n**Edge: ${player.pts_edge > 0 ? '+' : ''}${player.pts_edge}**`, inline: true },
                    { name: 'Rebounds', value: `Season: ${player.season_rpg}\nLast 5: ${player.recent_rpg}\n**Edge: ${player.reb_edge > 0 ? '+' : ''}${player.reb_edge}**`, inline: true },
                    { name: 'Assists', value: `Season: ${player.season_apg}\nLast 5: ${player.recent_apg}\n**Edge: ${player.ast_edge > 0 ? '+' : ''}${player.ast_edge}**`, inline: true }
                )
                .setFooter({ text: `Action: ${player.action} | Confidence: ${player.confidence}%` });
            await message.reply({ embeds: [embed] });
            return;
        }

        // Summary
        const hot = propsData.filter(p => p.status === 'HOT').slice(0, 5);
        const cold = propsData.filter(p => p.status === 'COLD').slice(0, 5);
        const fmt = (list) => list.length ? list.map(p => `**${p.player}**: ${p.pts_edge > 0 ? '+' : ''}${p.pts_edge}`).join('\n') : 'None';

        const embed = new EmbedBuilder()
            .setColor(0xFF6B35)
            .setTitle('🏀 NBA Props Report')
            .addFields(
                { name: '🔥 HOT (Bet OVER)', value: fmt(hot), inline: true },
                { name: '❄️ COLD (Bet UNDER)', value: fmt(cold), inline: true }
            )
            .setFooter({ text: '!props [player] for details' });
        await message.reply({ embeds: [embed] });
        return;
    }

    // !odds
    if (lower.startsWith('!odds')) {
        const query = content.slice(5).trim();
        if (!query) {
            await message.reply('🎰 Usage: `!odds [team]`');
            return;
        }

        try {
            await message.channel.sendTyping();
            const terms = expandTerms(query);
            const sport = detectSport(query) || 'basketball_nba';

            const [kalshiData, oddsGames] = await Promise.all([
                getKalshiMarkets(),
                getOddsForSport(sport)
            ]);

            const kalshiMatches = searchKalshi(kalshiData, terms);
            const oddsMatches = searchOddsApi(oddsGames, terms);

            if (kalshiMatches.length === 0 && oddsMatches.length === 0) {
                await message.reply(`❌ No odds for **${query}**`);
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(0x00FF88)
                .setTitle(`Odds: ${query.toUpperCase()}`);

            // Kalshi
            if (kalshiMatches.length > 0) {
                let text = '';
                kalshiMatches.slice(0, 2).forEach(m => {
                    const yes = m.yes_bid || 50;
                    const no = 100 - yes;
                    const title = (m.title || '').length > 40 ? m.title.substring(0, 39) + '...' : m.title;
                    text += `**${title}**\nYes: ${yes}¢ (${formatOdds(centsToAmericanOdds(yes))}) • No: ${no}¢\n\n`;
                });
                if (text) embed.addFields({ name: '🟣 Kalshi', value: text.trim(), inline: false });
            }

            // Sportsbooks
            if (oddsMatches.length > 0) {
                const game = oddsMatches[0];
                const books = game.bookmakers || [];

                if (books.length > 0) {
                    let mlText = '';
                    books.slice(0, 4).forEach(book => {
                        const h2h = book.markets.find(m => m.key === 'h2h');
                        if (h2h) {
                            const away = h2h.outcomes.find(o => o.name === game.away_team);
                            const home = h2h.outcomes.find(o => o.name === game.home_team);
                            if (away && home) mlText += `**${book.title}:** ${formatOdds(away.price)} / ${formatOdds(home.price)}\n`;
                        }
                    });
                    if (mlText) embed.addFields({ name: '📚 Moneyline', value: mlText.trim(), inline: false });
                }
            }

            await message.reply({ embeds: [embed] });
        } catch (error) {
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }

    // !games
    if (lower.startsWith('!games')) {
        const sportInput = content.slice(6).trim().toUpperCase() || 'NBA';

        try {
            await message.channel.sendTyping();

            const sportKey = SPORT_KEYS[sportInput];
            if (!sportKey) {
                await message.reply('❌ Try: NBA, NFL, MLB, NHL');
                return;
            }

            const games = await getOddsForSport(sportKey);
            const now = new Date();
            const cutoff = new Date(now.getTime() + 48 * 3600000);

            const upcoming = games
                .filter(g => new Date(g.commence_time) >= now && new Date(g.commence_time) <= cutoff)
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor(0x00AA00)
                .setTitle(`${sportInput} Games`);

            if (upcoming.length > 0) {
                let text = '';
                upcoming.forEach(g => {
                    const time = new Date(g.commence_time).toLocaleTimeString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
                    text += `**${time}** • ${g.away_team} @ ${g.home_team}\n`;
                });
                embed.setDescription(text);
            } else {
                embed.setDescription(`No ${sportInput} games in 48h.`);
            }

            await message.reply({ embeds: [embed] });
        } catch (error) {
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }

    // !kalshi
    if (lower.startsWith('!kalshi')) {
        const query = content.slice(7).trim().toUpperCase();

        try {
            await message.channel.sendTyping();

            const markets = await getKalshiMarkets();
            let filtered = markets;

            if (query) {
                const terms = query.split(' ').filter(t => t.length > 1);
                filtered = markets.filter(m => {
                    const text = `${m.title || ''} ${m.ticker || ''}`.toUpperCase();
                    return terms.some(t => text.includes(t));
                });
            }

            filtered = filtered.slice(0, 8);

            const embed = new EmbedBuilder()
                .setColor(0x6B5BFF)
                .setTitle(query ? `Kalshi: "${query}"` : 'Kalshi Top Markets');

            if (filtered.length > 0) {
                let text = '';
                filtered.forEach(m => {
                    const yes = m.yes_bid || 50;
                    const title = (m.title || '').length > 45 ? m.title.substring(0, 44) + '...' : m.title || 'Unknown';
                    text += `**${title}**\nYes: ${yes}¢ (${formatOdds(centsToAmericanOdds(yes))})\n\n`;
                });
                embed.setDescription(text.trim());
            } else {
                embed.setDescription('No markets found.');
            }

            await message.reply({ embeds: [embed] });
        } catch (error) {
            await message.reply('❌ Error fetching Kalshi.');
        }
        return;
    }

    // !ask
    if (lower.startsWith('!ask ')) {
        const q = content.slice(5).trim();
        if (!q) return;

        try {
            addHistory(message.channel.id, 'user', q);
            await message.channel.sendTyping();
            const res = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                system: SYSTEM_PROMPT,
                messages: getHistory(message.channel.id)
            });
            const answer = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
            addHistory(message.channel.id, 'assistant', answer);
            await sendResponse(message, answer);
        } catch (error) {
            await message.reply('❌ Error');
        }
        return;
    }
});

/* ============================================================================
   STARTUP
   ============================================================================ */

console.log('Starting Vector Edge Bot...');
client.login(process.env.DISCORD_TOKEN);
