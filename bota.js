/**
 * ============================================================================
 * DISCORD BOT - SPORTS BETTING WITH LIVE MOVEMENT DETECTION
 * ============================================================================
 * 
 * Key Features:
 *   - Kalshi/Polymarket shown FIRST (1-3s latency - fastest public source)
 *   - Price movement detection (tracks changes over time)
 *   - Live game scores when available
 *   - Sportsbook odds comparison
 * 
 * Latency Hierarchy (from your research):
 *   - Courtsiders: 0.5-1.5s (not accessible)
 *   - Kalshi prices: 1-3s ← WE USE THIS
 *   - ESPN API: 30-50s
 *   - Cable/Streaming: 45-90s
 * pip 
 * Commands:
 *   !odds [team]       - Full odds comparison (Kalshi first)
 *   !live [team]       - Live game with price movement alerts
 *   !games [sport]     - Today's games
 *   !kalshi [search]   - Search Kalshi markets
 *   !ask [question]    - Ask Claude AI
 * 
 * ============================================================================
 */

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
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
    'NCAAF': 'americanfootball_ncaaf',
    'UFC': 'mma_mixed_martial_arts'
};

// Team to Sport mapping
const TEAM_TO_SPORT = {
    // NBA
    'BUCKS': 'basketball_nba', 'MILWAUKEE': 'basketball_nba',
    'WIZARDS': 'basketball_nba', 'LAKERS': 'basketball_nba',
    'CELTICS': 'basketball_nba', 'BOSTON': 'basketball_nba',
    'WARRIORS': 'basketball_nba', 'GOLDEN STATE': 'basketball_nba',
    '76ERS': 'basketball_nba', 'SIXERS': 'basketball_nba', 'PHILADELPHIA': 'basketball_nba',
    'KINGS': 'basketball_nba', 'SACRAMENTO': 'basketball_nba',
    'HEAT': 'basketball_nba', 'MIAMI': 'basketball_nba',
    'BULLS': 'basketball_nba', 'CHICAGO': 'basketball_nba',
    'KNICKS': 'basketball_nba', 'NETS': 'basketball_nba',
    'SUNS': 'basketball_nba', 'PHOENIX': 'basketball_nba',
    'NUGGETS': 'basketball_nba', 'DENVER': 'basketball_nba',
    'ROCKETS': 'basketball_nba', 'HOUSTON': 'basketball_nba',
    'HAWKS': 'basketball_nba', 'ATLANTA': 'basketball_nba',
    'CAVALIERS': 'basketball_nba', 'CAVS': 'basketball_nba', 'CLEVELAND': 'basketball_nba',
    'MAVERICKS': 'basketball_nba', 'MAVS': 'basketball_nba', 'DALLAS': 'basketball_nba',
    'TIMBERWOLVES': 'basketball_nba', 'WOLVES': 'basketball_nba', 'MINNESOTA': 'basketball_nba',
    'PELICANS': 'basketball_nba', 'THUNDER': 'basketball_nba', 'OKC': 'basketball_nba',
    'MAGIC': 'basketball_nba', 'ORLANDO': 'basketball_nba',
    'PACERS': 'basketball_nba', 'INDIANA': 'basketball_nba',
    'PISTONS': 'basketball_nba', 'DETROIT': 'basketball_nba',
    'RAPTORS': 'basketball_nba', 'TORONTO': 'basketball_nba',
    'JAZZ': 'basketball_nba', 'UTAH': 'basketball_nba',
    'SPURS': 'basketball_nba', 'BLAZERS': 'basketball_nba', 'PORTLAND': 'basketball_nba',
    'CLIPPERS': 'basketball_nba', 'GRIZZLIES': 'basketball_nba', 'MEMPHIS': 'basketball_nba',
    'HORNETS': 'basketball_nba', 'CHARLOTTE': 'basketball_nba',

    // NFL
    'CHIEFS': 'americanfootball_nfl', 'KANSAS CITY': 'americanfootball_nfl',
    'EAGLES': 'americanfootball_nfl', 'BILLS': 'americanfootball_nfl', 'BUFFALO': 'americanfootball_nfl',
    'COWBOYS': 'americanfootball_nfl', 'RAVENS': 'americanfootball_nfl', 'BALTIMORE': 'americanfootball_nfl',
    '49ERS': 'americanfootball_nfl', 'NINERS': 'americanfootball_nfl',
    'PACKERS': 'americanfootball_nfl', 'GREEN BAY': 'americanfootball_nfl',
    'BENGALS': 'americanfootball_nfl', 'DOLPHINS': 'americanfootball_nfl',
    'LIONS': 'americanfootball_nfl', 'JETS': 'americanfootball_nfl', 'GIANTS': 'americanfootball_nfl',
    'PATRIOTS': 'americanfootball_nfl', 'STEELERS': 'americanfootball_nfl',
    'BRONCOS': 'americanfootball_nfl', 'RAIDERS': 'americanfootball_nfl',
    'CHARGERS': 'americanfootball_nfl', 'RAMS': 'americanfootball_nfl',
    'CARDINALS': 'americanfootball_nfl', 'SEAHAWKS': 'americanfootball_nfl',
    'SAINTS': 'americanfootball_nfl', 'FALCONS': 'americanfootball_nfl',
    'PANTHERS': 'americanfootball_nfl', 'BUCCANEERS': 'americanfootball_nfl', 'BUCS': 'americanfootball_nfl',
    'BEARS': 'americanfootball_nfl', 'VIKINGS': 'americanfootball_nfl',
    'COMMANDERS': 'americanfootball_nfl', 'BROWNS': 'americanfootball_nfl',
    'TEXANS': 'americanfootball_nfl', 'COLTS': 'americanfootball_nfl',
    'JAGUARS': 'americanfootball_nfl', 'TITANS': 'americanfootball_nfl',

    // MLB
    'YANKEES': 'baseball_mlb', 'RED SOX': 'baseball_mlb', 'DODGERS': 'baseball_mlb',
    'CUBS': 'baseball_mlb', 'METS': 'baseball_mlb', 'BRAVES': 'baseball_mlb',
    'ASTROS': 'baseball_mlb', 'PHILLIES': 'baseball_mlb',

    // NHL
    'BRUINS': 'icehockey_nhl', 'MAPLE LEAFS': 'icehockey_nhl', 'LEAFS': 'icehockey_nhl',
    'CANADIENS': 'icehockey_nhl', 'PENGUINS': 'icehockey_nhl', 'BLACKHAWKS': 'icehockey_nhl',
    'OILERS': 'icehockey_nhl', 'FLAMES': 'icehockey_nhl', 'CANUCKS': 'icehockey_nhl',
    'GOLDEN KNIGHTS': 'icehockey_nhl', 'KNIGHTS': 'icehockey_nhl', 'AVALANCHE': 'icehockey_nhl'
};

const TEAM_ALIASES = {
    'BUCKS': ['MILWAUKEE', 'MIL'], 'WIZARDS': ['WASHINGTON', 'WAS'],
    'LAKERS': ['LOS ANGELES LAKERS', 'LAL'], 'CELTICS': ['BOSTON', 'BOS'],
    '76ERS': ['PHILADELPHIA', 'PHI', 'SIXERS'], 'SIXERS': ['PHILADELPHIA', 'PHI', '76ERS'],
    'KINGS': ['SACRAMENTO', 'SAC'], 'WARRIORS': ['GOLDEN STATE', 'GSW'],
    'HEAT': ['MIAMI', 'MIA'], 'BULLS': ['CHICAGO', 'CHI'],
    'CHIEFS': ['KANSAS CITY', 'KC'], 'EAGLES': ['PHILADELPHIA', 'PHI'],
    'BILLS': ['BUFFALO', 'BUF'], 'COWBOYS': ['DALLAS', 'DAL']
};

const SYSTEM_PROMPT = `You are a sports betting assistant. Be direct and data-focused.`;
const HISTORY_LIMIT = 20;


/* ============================================================================
   CACHING & PRICE HISTORY SYSTEM
   ============================================================================ */

const cache = {
    kalshi: { data: null, timestamp: 0 },
    polymarket: { data: null, timestamp: 0 },
    oddsApi: new Map(),
    scores: new Map()
};

// Price history for movement detection (stores last 10 minutes of prices)
const priceHistory = new Map(); // marketId -> [{price, timestamp}, ...]

const CACHE_TTL = 30 * 1000; // 30 seconds for faster updates
const PRICE_HISTORY_TTL = 10 * 60 * 1000; // Keep 10 minutes of history

function isCacheValid(entry) {
    return entry.data && (Date.now() - entry.timestamp) < CACHE_TTL;
}

function recordPrice(marketId, price, teamName) {
    if (!priceHistory.has(marketId)) {
        priceHistory.set(marketId, []);
    }
    const history = priceHistory.get(marketId);
    history.push({ price, timestamp: Date.now(), team: teamName });

    // Clean old entries
    const cutoff = Date.now() - PRICE_HISTORY_TTL;
    while (history.length > 0 && history[0].timestamp < cutoff) {
        history.shift();
    }
}

function getPriceMovement(marketId) {
    const history = priceHistory.get(marketId);
    if (!history || history.length < 2) return null;

    const current = history[history.length - 1];
    const oldest = history[0];
    const minutesAgo = Math.round((current.timestamp - oldest.timestamp) / 60000);

    if (minutesAgo < 1) return null;

    const change = current.price - oldest.price;
    if (Math.abs(change) < 3) return null; // Ignore small movements

    return {
        change,
        minutesAgo,
        direction: change > 0 ? 'up' : 'down',
        team: current.team
    };
}


/* ============================================================================
   INITIALIZE CLIENTS
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

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

const conversationHistory = new Map();


/* ============================================================================
   HELPER FUNCTIONS
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

function formatVolume(num) {
    if (!num) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

function centsToAmericanOdds(cents) {
    if (!cents || cents <= 0 || cents >= 100) return null;
    if (cents >= 50) return Math.round(-(cents / (100 - cents)) * 100);
    return Math.round(((100 - cents) / cents) * 100);
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
    const terms = query.toUpperCase().split(/\s+VS\s+|\s+@\s+|\s+/).filter(t => t.length > 2);
    const expanded = new Set(terms);
    terms.forEach(term => {
        if (TEAM_ALIASES[term]) TEAM_ALIASES[term].forEach(a => expanded.add(a));
        Object.entries(TEAM_ALIASES).forEach(([k, v]) => {
            if (v.includes(term)) { expanded.add(k); v.forEach(a => expanded.add(a)); }
        });
    });
    return Array.from(expanded);
}


/* ============================================================================
   API FUNCTIONS
   ============================================================================ */

async function getKalshiMarkets() {
    if (isCacheValid(cache.kalshi)) {
        console.log('[Kalshi] Cache hit');
        return cache.kalshi.data;
    }

    console.log('[Kalshi] Fetching...');
    try {
        const res = await axios.get('https://api.elections.kalshi.com/trade-api/v2/markets', {
            params: { limit: 500, status: 'open' },
            timeout: 10000
        });

        const markets = (res.data.markets || []).filter(m => {
            const ticker = (m.ticker || '').toUpperCase();
            if (ticker.includes('MULTIGAME') || ticker.includes('EXTENDED')) return false;
            if (((m.title || '').match(/YES/gi) || []).length > 1) return false;
            return true;
        });

        // Record prices for movement detection
        markets.forEach(m => {
            if (m.yes_bid) {
                recordPrice(m.ticker, m.yes_bid, m.title);
            }
        });

        cache.kalshi = { data: markets, timestamp: Date.now() };
        console.log(`[Kalshi] Cached ${markets.length} markets`);
        return markets;
    } catch (error) {
        console.error('[Kalshi] Error:', error.message);
        return cache.kalshi.data || [];
    }
}

async function getPolymarketEvents() {
    if (isCacheValid(cache.polymarket)) {
        console.log('[Polymarket] Cache hit');
        return cache.polymarket.data;
    }

    console.log('[Polymarket] Fetching...');
    try {
        const res = await axios.get('https://gamma-api.polymarket.com/events', {
            params: { limit: 100, active: true, closed: false },
            timeout: 10000
        });

        const events = Array.isArray(res.data) ? res.data : [];
        cache.polymarket = { data: events, timestamp: Date.now() };
        console.log(`[Polymarket] Cached ${events.length} events`);
        return events;
    } catch (error) {
        console.error('[Polymarket] Error:', error.message);
        return cache.polymarket.data || [];
    }
}

async function getOddsForSport(sport) {
    if (!ODDS_API_KEY) return [];

    const cached = cache.oddsApi.get(sport);
    if (cached && isCacheValid(cached)) {
        console.log(`[OddsAPI] Cache hit: ${sport}`);
        return cached.data;
    }

    console.log(`[OddsAPI] Fetching ${sport}...`);
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

        console.log(`[OddsAPI] ${sport}: ${res.data?.length || 0} games, Quota: ${res.headers['x-requests-remaining']}`);

        const data = res.data || [];
        cache.oddsApi.set(sport, { data, timestamp: Date.now() });
        return data;
    } catch (error) {
        console.error(`[OddsAPI] ${sport}:`, error.message);
        return cached?.data || [];
    }
}

async function getLiveScores(sport) {
    if (!ODDS_API_KEY) return [];

    const cached = cache.scores.get(sport);
    if (cached && isCacheValid(cached)) {
        return cached.data;
    }

    try {
        const res = await axios.get(`${ODDS_API_HOST}/${ODDS_API_VERSION}/sports/${sport}/scores`, {
            params: { apiKey: ODDS_API_KEY },
            timeout: 10000
        });

        const data = res.data || [];
        cache.scores.set(sport, { data, timestamp: Date.now() });
        return data;
    } catch (error) {
        return [];
    }
}


/* ============================================================================
   SEARCH FUNCTIONS
   ============================================================================ */

function searchKalshi(markets, terms) {
    return markets.filter(m => {
        const text = `${m.title} ${m.ticker}`.toUpperCase();
        return terms.some(t => text.includes(t));
    });
}

function searchPolymarket(events, terms) {
    return events.filter(e => {
        const title = (e.title || '').toUpperCase();
        const isSports = ['NBA', 'NFL', 'MLB', 'NHL', 'UFC', 'BASKETBALL', 'FOOTBALL'].some(k => title.includes(k));
        const isFutures = ['CHAMPION', 'MVP', 'WINNER 202', 'AWARD'].some(k => title.includes(k));
        if (!isSports || isFutures) return false;
        return terms.some(t => title.includes(t));
    });
}

function searchOddsApi(games, terms) {
    return games.filter(g => {
        const text = `${g.home_team} ${g.away_team}`.toUpperCase();
        return terms.some(t => text.includes(t));
    });
}


/* ============================================================================
   BOT READY
   ============================================================================ */

client.on('ready', () => {
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  ✅ BOT ONLINE: ${client.user.tag}`);
    console.log(`  📅 ${new Date().toLocaleString()}`);
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Data Latency (your research):');
    console.log('    🟣 Kalshi:     1-3 seconds  ← FASTEST PUBLIC');
    console.log('    📚 Sportsbooks: varies');
    console.log('    📺 ESPN:       30-50 seconds');
    console.log('    📺 Streaming:  45-90 seconds');
    console.log('');
    console.log(`  ODDS_API_KEY: ${ODDS_API_KEY ? '✅' : '❌'}`);
    console.log('  Cache TTL: 30s | Price History: 10min');
    console.log('══════════════════════════════════════════════════════════');
});


/* ============================================================================
   MESSAGE HANDLER
   ============================================================================ */

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim();
    const lower = content.toLowerCase();


    /* ========================================================================
       COMMAND: !help
       ======================================================================== */
    if (lower === '!help') {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🤖 Commands')
            .setDescription('**Data Latency:**\n🟣 Kalshi: 1-3s (fastest)\n📚 Books: varies\n📺 ESPN: 30-50s')
            .addFields(
                { name: '🎰 Betting', value: '`!odds [team]` - Full comparison\n`!live [team]` - Live + movement\n`!games [sport]` - Schedule\n`!kalshi [search]` - Markets', inline: false },
                { name: '💬 AI', value: '`!ask [q]` • `!math` • `!summary`', inline: false }
            );
        await message.reply({ embeds: [embed] });
        return;
    }


    /* ========================================================================
       COMMAND: !clear
       ======================================================================== */
    if (lower === '!clear') {
        conversationHistory.set(message.channel.id, []);
        await message.reply('🧹 Cleared!');
        return;
    }


    /* ========================================================================
       COMMAND: !live [team] - Live game with price movement
       ======================================================================== */
    if (lower.startsWith('!live')) {
        const query = content.slice(5).trim();

        if (!query) {
            await message.reply('📺 **Usage:** `!live [team]`\nShows live game with Kalshi price movement alerts');
            return;
        }

        try {
            await message.channel.sendTyping();

            const terms = expandTerms(query);
            const sport = detectSport(query);

            // Fetch data
            const [kalshiData, oddsGames, scores] = await Promise.all([
                getKalshiMarkets(),
                sport ? getOddsForSport(sport) : getOddsForSport('basketball_nba'),
                sport ? getLiveScores(sport) : getLiveScores('basketball_nba')
            ]);

            const kalshiMatches = searchKalshi(kalshiData, terms);
            const gameMatches = searchOddsApi(oddsGames, terms);

            if (kalshiMatches.length === 0 && gameMatches.length === 0) {
                await message.reply(`❌ No live data for **"${query}"**`);
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(0xFF0000)
                .setTitle(`📺 LIVE: ${query.toUpperCase()}`)
                .setFooter({ text: '🟣 Kalshi = 1-3s delay (fastest) | 📺 ESPN = 30-50s delay' });

            // Find matching score
            let scoreInfo = null;
            if (scores.length > 0 && gameMatches.length > 0) {
                const game = gameMatches[0];
                scoreInfo = scores.find(s =>
                    s.home_team === game.home_team && s.away_team === game.away_team
                );
            }

            // Score section
            if (scoreInfo && scoreInfo.scores) {
                const homeScore = scoreInfo.scores.find(s => s.name === scoreInfo.home_team)?.score || '0';
                const awayScore = scoreInfo.scores.find(s => s.name === scoreInfo.away_team)?.score || '0';
                const status = scoreInfo.completed ? '✅ FINAL' : '🔴 LIVE';

                embed.setDescription(`**${scoreInfo.away_team}** ${awayScore} - ${homeScore} **${scoreInfo.home_team}**\n${status}`);
            } else if (gameMatches.length > 0) {
                const g = gameMatches[0];
                const time = new Date(g.commence_time).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
                embed.setDescription(`**${g.away_team} @ ${g.home_team}**\n📅 ${time}`);
            }

            // Kalshi with movement detection
            if (kalshiMatches.length > 0) {
                let text = "";
                kalshiMatches.slice(0, 3).forEach(m => {
                    const yesPrice = m.yes_bid || 50;
                    const noPrice = 100 - yesPrice;
                    const yesOdds = centsToAmericanOdds(yesPrice);
                    const noOdds = centsToAmericanOdds(noPrice);

                    // Check for price movement
                    const movement = getPriceMovement(m.ticker);
                    let moveText = "";
                    if (movement) {
                        const arrow = movement.direction === 'up' ? '📈' : '📉';
                        const sign = movement.change > 0 ? '+' : '';
                        moveText = `\n${arrow} **${sign}${movement.change}¢** in last ${movement.minutesAgo}min`;
                    }

                    const title = m.title.length > 45 ? m.title.substring(0, 44) + '...' : m.title;
                    text += `**${title}**\n`;
                    text += `Yes: ${yesPrice}¢ (${formatOdds(yesOdds)}) • No: ${noPrice}¢ (${formatOdds(noOdds)})${moveText}\n\n`;
                });

                embed.addFields({
                    name: '🟣 Kalshi (1-3s delay - FASTEST)',
                    value: text.trim(),
                    inline: false
                });
            }

            // Sportsbook odds
            if (gameMatches.length > 0) {
                const game = gameMatches[0];
                const books = game.bookmakers || [];

                if (books.length > 0) {
                    let mlText = "";
                    books.slice(0, 4).forEach(book => {
                        const h2h = book.markets.find(m => m.key === 'h2h');
                        if (h2h) {
                            const away = h2h.outcomes.find(o => o.name === game.away_team);
                            const home = h2h.outcomes.find(o => o.name === game.home_team);
                            if (away && home) {
                                mlText += `**${book.title}:** ${formatOdds(away.price)} / ${formatOdds(home.price)}\n`;
                            }
                        }
                    });
                    if (mlText) embed.addFields({ name: '📚 Sportsbooks', value: mlText.trim(), inline: false });
                }
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!live] Error:', error);
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }


    /* ========================================================================
       COMMAND: !odds [team]
       ======================================================================== */
    if (lower.startsWith('!odds')) {
        const query = content.slice(5).trim();

        if (!query) {
            await message.reply('🎰 **Usage:** `!odds [team]`\nExamples: `!odds bucks`, `!odds chiefs`');
            return;
        }

        try {
            await message.channel.sendTyping();

            const terms = expandTerms(query);
            const sport = detectSport(query);

            console.log(`[!odds] "${query}" → Terms: ${terms.slice(0, 5).join(', ')} | Sport: ${sport || 'auto'}`);

            const [kalshiData, polyData, oddsGames] = await Promise.all([
                getKalshiMarkets(),
                getPolymarketEvents(),
                sport ? getOddsForSport(sport) : getOddsForSport('basketball_nba')
            ]);

            const kalshiMatches = searchKalshi(kalshiData, terms);
            const polyMatches = searchPolymarket(polyData, terms);
            const oddsMatches = searchOddsApi(oddsGames, terms);

            console.log(`[!odds] Results - Kalshi: ${kalshiMatches.length}, Poly: ${polyMatches.length}, Books: ${oddsMatches.length}`);

            if (kalshiMatches.length === 0 && polyMatches.length === 0 && oddsMatches.length === 0) {
                await message.reply(`❌ No odds for **"${query}"**\nTry: \`!odds bucks\`, \`!odds lakers\``);
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(0x00FF88)
                .setTitle(`🎰 Odds: ${query.toUpperCase()}`)
                .setFooter({ text: '🟣 Kalshi = fastest (1-3s) | 📚 Books = varies' });

            // KALSHI
            if (kalshiMatches.length > 0) {
                let text = "";
                kalshiMatches.slice(0, 2).forEach(m => {
                    const yes = m.yes_bid || 50;
                    const no = 100 - yes;
                    const movement = getPriceMovement(m.ticker);
                    let moveText = "";
                    if (movement) {
                        const arrow = movement.direction === 'up' ? '📈' : '📉';
                        moveText = ` ${arrow}${movement.change > 0 ? '+' : ''}${movement.change}¢`;
                    }

                    const title = m.title.length > 40 ? m.title.substring(0, 39) + '...' : m.title;
                    text += `**${title}**\nYes: ${yes}¢ (${formatOdds(centsToAmericanOdds(yes))})${moveText} • No: ${no}¢ (${formatOdds(centsToAmericanOdds(no))})\n\n`;
                });
                embed.addFields({ name: '🟣 Kalshi (1-3s delay)', value: text.trim(), inline: false });
            }

            // POLYMARKET
            if (polyMatches.length > 0) {
                let text = "";
                polyMatches.slice(0, 2).forEach(e => {
                    let yes = 50;
                    try {
                        if (e.markets?.[0]?.outcomePrices) {
                            yes = Math.round(parseFloat(JSON.parse(e.markets[0].outcomePrices)[0] || 0.5) * 100);
                        }
                    } catch { }
                    const no = 100 - yes;
                    const title = e.title.length > 40 ? e.title.substring(0, 39) + '...' : e.title;
                    text += `**${title}**\nYes: ${yes}¢ (${formatOdds(centsToAmericanOdds(yes))}) • No: ${no}¢ (${formatOdds(centsToAmericanOdds(no))})\n\n`;
                });
                embed.addFields({ name: '🔵 Polymarket', value: text.trim(), inline: false });
            }

            // SPORTSBOOKS
            if (oddsMatches.length > 0) {
                const game = oddsMatches[0];
                const books = game.bookmakers || [];

                const time = new Date(game.commence_time).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
                embed.setDescription(`**${game.away_team} @ ${game.home_team}**\n📅 ${time}`);

                if (books.length > 0) {
                    let mlText = "";
                    books.slice(0, 5).forEach(book => {
                        const h2h = book.markets.find(m => m.key === 'h2h');
                        if (h2h) {
                            const away = h2h.outcomes.find(o => o.name === game.away_team);
                            const home = h2h.outcomes.find(o => o.name === game.home_team);
                            if (away && home) {
                                mlText += `**${book.title}:** ${formatOdds(away.price)} / ${formatOdds(home.price)}\n`;
                            }
                        }
                    });
                    if (mlText) embed.addFields({ name: '📚 Sportsbooks - ML (Away/Home)', value: mlText.trim(), inline: false });

                    let spText = "";
                    books.slice(0, 4).forEach(book => {
                        const sp = book.markets.find(m => m.key === 'spreads');
                        if (sp) {
                            const away = sp.outcomes.find(o => o.name === game.away_team);
                            const home = sp.outcomes.find(o => o.name === game.home_team);
                            if (away && home) {
                                spText += `**${book.title}:** ${away.point > 0 ? '+' : ''}${away.point} / ${home.point > 0 ? '+' : ''}${home.point}\n`;
                            }
                        }
                    });
                    if (spText) embed.addFields({ name: '📊 Spread', value: spText.trim(), inline: true });

                    let totText = "";
                    books.slice(0, 4).forEach(book => {
                        const tot = book.markets.find(m => m.key === 'totals');
                        if (tot) {
                            const over = tot.outcomes.find(o => o.name === 'Over');
                            if (over) totText += `**${book.title}:** O/U ${over.point}\n`;
                        }
                    });
                    if (totText) embed.addFields({ name: '🎯 Total', value: totText.trim(), inline: true });
                }
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!odds] Error:', error);
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }


    /* ========================================================================
       COMMAND: !games [sport]
       ======================================================================== */
    if (lower.startsWith('!games')) {
        const sportInput = content.slice(6).trim().toUpperCase() || 'NBA';

        try {
            await message.channel.sendTyping();

            if (!ODDS_API_KEY) {
                await message.reply('❌ ODDS_API_KEY not set');
                return;
            }

            const sportKey = SPORT_KEYS[sportInput];
            if (!sportKey) {
                await message.reply(`❌ Unknown sport. Try: NBA, NFL, MLB, NHL`);
                return;
            }

            const games = await getOddsForSport(sportKey);
            const now = new Date();
            const cutoff = new Date(now.getTime() + 48 * 3600000);

            const upcoming = games
                .filter(g => new Date(g.commence_time) >= now && new Date(g.commence_time) <= cutoff)
                .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor(0x00AA00)
                .setTitle(`🏀 ${sportInput} Games`)
                .setFooter({ text: '!odds [team] for details | !live [team] for live' });

            if (upcoming.length > 0) {
                let text = "";
                upcoming.forEach(g => {
                    const time = new Date(g.commence_time).toLocaleTimeString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
                    let odds = "";
                    const h2h = g.bookmakers?.[0]?.markets?.find(m => m.key === 'h2h');
                    if (h2h) {
                        const away = h2h.outcomes.find(o => o.name === g.away_team);
                        const home = h2h.outcomes.find(o => o.name === g.home_team);
                        if (away && home) odds = ` (${formatOdds(away.price)}/${formatOdds(home.price)})`;
                    }
                    text += `**${time}** • ${g.away_team} @ ${g.home_team}${odds}\n`;
                });
                embed.setDescription(text);
            } else {
                embed.setDescription(`No ${sportInput} games in 48h.`);
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!games]', error);
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }


    /* ========================================================================
       COMMAND: !kalshi [search]
       ======================================================================== */
    if (lower.startsWith('!kalshi')) {
        const query = content.slice(7).trim().toUpperCase();

        try {
            await message.channel.sendTyping();

            const markets = await getKalshiMarkets();
            let filtered = markets;

            if (query) {
                const terms = query.split(' ').filter(t => t.length > 1);
                filtered = markets.filter(m => {
                    const text = `${m.title} ${m.category} ${m.ticker}`.toUpperCase();
                    return terms.some(t => text.includes(t));
                });
            }

            const now = new Date();
            filtered = filtered
                .filter(m => m.close_time && new Date(m.close_time) > now)
                .sort((a, b) => (b.volume || 0) - (a.volume || 0))
                .slice(0, 8);

            const embed = new EmbedBuilder()
                .setColor(0x6B5BFF)
                .setTitle(query ? `🔮 Kalshi: "${query}"` : '🔮 Kalshi Top Markets')
                .setFooter({ text: '1-3 second latency - fastest public source' });

            if (filtered.length > 0) {
                let text = "";
                filtered.forEach(m => {
                    const yes = m.yes_bid || 50;
                    const no = 100 - yes;
                    const hours = Math.round((new Date(m.close_time) - now) / 3600000);
                    const timeStr = hours > 48 ? `${Math.round(hours / 24)}d` : `${hours}h`;

                    const movement = getPriceMovement(m.ticker);
                    let moveText = "";
                    if (movement) {
                        const arrow = movement.direction === 'up' ? '📈' : '📉';
                        moveText = ` ${arrow}${movement.change > 0 ? '+' : ''}${movement.change}¢`;
                    }

                    const title = m.title.length > 45 ? m.title.substring(0, 44) + '...' : m.title;
                    text += `**${title}**\nYes: ${yes}¢ (${formatOdds(centsToAmericanOdds(yes))})${moveText} • No: ${no}¢ • ⏰${timeStr}\n\n`;
                });
                embed.setDescription(text.trim());
            } else {
                embed.setDescription(query ? `No markets for "${query}"` : 'No markets.');
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!kalshi]', error);
            await message.reply('❌ Error fetching Kalshi.');
        }
        return;
    }


    /* ========================================================================
       AI COMMANDS
       ======================================================================== */
    if (lower.startsWith('!math ')) {
        const problem = content.slice(6).trim();
        if (!problem) return message.reply('🔢 Example: `!math 25*4`');
        await message.channel.sendTyping();
        const res = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514', max_tokens: 1024,
            messages: [{ role: 'user', content: `Solve concisely:\n${problem}` }]
        });
        await sendResponse(message, res.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
        return;
    }

    if (lower.startsWith('!summary ')) {
        const text = content.slice(9).trim();
        if (!text) return message.reply('📝 Example: `!summary [text]`');
        await message.channel.sendTyping();
        const res = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514', max_tokens: 1024,
            messages: [{ role: 'user', content: `Summarize briefly:\n${text}` }]
        });
        await sendResponse(message, res.content.filter(b => b.type === 'text').map(b => b.text).join('\n'));
        return;
    }

    if (lower.startsWith('!ask ')) {
        const q = content.slice(5).trim();
        if (!q) return message.reply('❓ Example: `!ask What is...`');
        addHistory(message.channel.id, 'user', q);
        await message.channel.sendTyping();
        const res = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514', max_tokens: 1024,
            system: SYSTEM_PROMPT, messages: getHistory(message.channel.id),
            tools: [{ type: "web_search_20250305", name: "web_search" }]
        });
        const answer = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
        addHistory(message.channel.id, 'assistant', answer);
        await sendResponse(message, answer);
        return;
    }

    if (message.mentions.has(client.user)) {
        const q = content.replace(/<@!?\d+>/g, '').trim();
        if (q) {
            addHistory(message.channel.id, 'user', q);
            const res = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514', max_tokens: 1024,
                system: SYSTEM_PROMPT, messages: getHistory(message.channel.id)
            });
            const answer = res.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
            addHistory(message.channel.id, 'assistant', answer);
            await sendResponse(message, answer);
        }
        return;
    }
});


/* ============================================================================
   STARTUP
   ============================================================================ */

console.log('🚀 Starting bot with movement detection...');
console.log(`  ODDS_API_KEY: ${ODDS_API_KEY ? '✅' : '❌'}`);
client.login(process.env.DISCORD_TOKEN);