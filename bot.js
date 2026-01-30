/**
 * ============================================================================
 * DISCORD BOT - SPORTS BETTING & AI ASSISTANT
 * ============================================================================
 * 
 * Commands:
 *   !odds [team]       - Compare odds across sportsbooks (Kalshi/Polymarket first)
 *   !games [sport]     - List today's games with odds
 *   !kalshi [search]   - Search Kalshi prediction markets
 *   !ask [question]    - Ask Claude AI (with web search)
 *   !math [problem]    - Step-by-step math solver
 *   !summary [text]    - Summarize long text
 *   !clear             - Clear conversation memory
 *   !help              - Show all commands
 * 
 * ============================================================================
 */

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
require('dotenv').config();

// Get Odds API key (check multiple possible variable names)
const ODDS_API_KEY = process.env.ODDS_API_KEY || process.env.THEODDSAPI_KEY || process.env.ODDSAPIKEY;


/* ============================================================================
   CONFIGURATION
   ============================================================================ */

const ODDS_API_HOST = 'https://api.the-odds-api.com';
const ODDS_API_VERSION = 'v4';

const SPORT_KEYS = {
    'NBA': 'basketball_nba',
    'BASKETBALL': 'basketball_nba',
    'NFL': 'americanfootball_nfl',
    'FOOTBALL': 'americanfootball_nfl',
    'MLB': 'baseball_mlb',
    'BASEBALL': 'baseball_mlb',
    'NHL': 'icehockey_nhl',
    'HOCKEY': 'icehockey_nhl',
    'NCAAB': 'basketball_ncaab',
    'CBB': 'basketball_ncaab',
    'NCAAF': 'americanfootball_ncaaf',
    'CFB': 'americanfootball_ncaaf',
    'UFC': 'mma_mixed_martial_arts',
    'MMA': 'mma_mixed_martial_arts',
    'MLS': 'soccer_usa_mls',
    'EPL': 'soccer_epl'
};

// Team name mappings for Kalshi/Polymarket (they use city names)
const TEAM_MAPPINGS = {
    // NBA
    'BUCKS': ['MILWAUKEE', 'MIL'],
    'WIZARDS': ['WASHINGTON', 'WAS'],
    'LAKERS': ['LOS ANGELES LAKERS', 'LAL', 'LA LAKERS'],
    'CELTICS': ['BOSTON', 'BOS'],
    'WARRIORS': ['GOLDEN STATE', 'GSW', 'GS'],
    '76ERS': ['PHILADELPHIA', 'PHI', 'SIXERS', 'PHILLY'],
    'SIXERS': ['PHILADELPHIA', 'PHI', '76ERS', 'PHILLY'],
    'KINGS': ['SACRAMENTO', 'SAC'],
    'HEAT': ['MIAMI', 'MIA'],
    'BULLS': ['CHICAGO', 'CHI'],
    'KNICKS': ['NEW YORK KNICKS', 'NYK', 'NY KNICKS'],
    'NETS': ['BROOKLYN', 'BKN'],
    'SUNS': ['PHOENIX', 'PHX'],
    'NUGGETS': ['DENVER', 'DEN'],
    'ROCKETS': ['HOUSTON', 'HOU'],
    'HAWKS': ['ATLANTA', 'ATL'],
    'CAVALIERS': ['CLEVELAND', 'CLE', 'CAVS'],
    'MAVERICKS': ['DALLAS', 'DAL', 'MAVS'],
    'TIMBERWOLVES': ['MINNESOTA', 'MIN', 'WOLVES'],
    'PELICANS': ['NEW ORLEANS', 'NOP', 'NOLA'],
    'THUNDER': ['OKLAHOMA CITY', 'OKC'],
    'MAGIC': ['ORLANDO', 'ORL'],
    'PACERS': ['INDIANA', 'IND'],
    'PISTONS': ['DETROIT', 'DET'],
    'RAPTORS': ['TORONTO', 'TOR'],
    'JAZZ': ['UTAH', 'UTA'],
    'SPURS': ['SAN ANTONIO', 'SAS'],
    'TRAIL BLAZERS': ['PORTLAND', 'POR', 'BLAZERS'],
    'CLIPPERS': ['LOS ANGELES CLIPPERS', 'LAC', 'LA CLIPPERS'],
    'GRIZZLIES': ['MEMPHIS', 'MEM'],
    'HORNETS': ['CHARLOTTE', 'CHA'],
    // NFL
    'CHIEFS': ['KANSAS CITY', 'KC'],
    'EAGLES': ['PHILADELPHIA', 'PHI'],
    'BILLS': ['BUFFALO', 'BUF'],
    'COWBOYS': ['DALLAS', 'DAL'],
    'RAVENS': ['BALTIMORE', 'BAL'],
    '49ERS': ['SAN FRANCISCO', 'SF'],
    'PACKERS': ['GREEN BAY', 'GB'],
    'BENGALS': ['CINCINNATI', 'CIN'],
    'DOLPHINS': ['MIAMI', 'MIA'],
    'LIONS': ['DETROIT', 'DET'],
    'JETS': ['NEW YORK JETS', 'NYJ'],
    'GIANTS': ['NEW YORK GIANTS', 'NYG'],
    'PATRIOTS': ['NEW ENGLAND', 'NE'],
    'STEELERS': ['PITTSBURGH', 'PIT'],
    'BRONCOS': ['DENVER', 'DEN'],
    'RAIDERS': ['LAS VEGAS', 'LV'],
    'CHARGERS': ['LOS ANGELES CHARGERS', 'LAC'],
    'RAMS': ['LOS ANGELES RAMS', 'LAR'],
    'CARDINALS': ['ARIZONA', 'ARI'],
    'SEAHAWKS': ['SEATTLE', 'SEA'],
    'SAINTS': ['NEW ORLEANS', 'NO'],
    'FALCONS': ['ATLANTA', 'ATL'],
    'PANTHERS': ['CAROLINA', 'CAR'],
    'BUCCANEERS': ['TAMPA BAY', 'TB', 'BUCS'],
    'BEARS': ['CHICAGO', 'CHI'],
    'VIKINGS': ['MINNESOTA', 'MIN'],
    'COMMANDERS': ['WASHINGTON', 'WAS'],
    'BROWNS': ['CLEVELAND', 'CLE'],
    'TEXANS': ['HOUSTON', 'HOU'],
    'COLTS': ['INDIANAPOLIS', 'IND'],
    'JAGUARS': ['JACKSONVILLE', 'JAX'],
    'TITANS': ['TENNESSEE', 'TEN']
};

const SYSTEM_PROMPT = `You are a smart, witty AI assistant in a Discord server.
You're talking to people in their 20s, so:
- Be direct and to the point
- Don't over-explain or be condescending
- Use emojis sparingly
- Keep responses concise but informative
- It's fine to say "I don't know"`;

const HISTORY_LIMIT = 20;


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

function getConversationHistory(channelId) {
    if (!conversationHistory.has(channelId)) {
        conversationHistory.set(channelId, []);
    }
    return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
    const history = getConversationHistory(channelId);
    history.push({ role, content });
    if (history.length > HISTORY_LIMIT) history.shift();
}

function clearHistory(channelId) {
    conversationHistory.set(channelId, []);
}

async function sendResponse(message, response) {
    await message.channel.sendTyping();
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

/**
 * Convert cents/percentage to American odds
 * 60¢ (60%) = -150
 * 40¢ (40%) = +150
 */
function centsToAmericanOdds(cents) {
    if (!cents || cents <= 0 || cents >= 100) return null;
    
    if (cents >= 50) {
        // Favorite: negative odds
        const odds = Math.round(-(cents / (100 - cents)) * 100);
        return odds;
    } else {
        // Underdog: positive odds
        const odds = Math.round(((100 - cents) / cents) * 100);
        return `+${odds}`;
    }
}

/**
 * Format American odds with + or - sign
 */
function formatAmericanOdds(odds) {
    if (odds === null || odds === undefined) return '—';
    if (typeof odds === 'string') return odds;
    return odds > 0 ? `+${odds}` : `${odds}`;
}

async function chatWithClaude(channelId, userMessage) {
    try {
        addToHistory(channelId, 'user', userMessage);
        const history = getConversationHistory(channelId);

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: history,
            tools: [{ type: "web_search_20250305", name: "web_search" }]
        });

        const assistantMessage = response.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n\n');

        addToHistory(channelId, 'assistant', assistantMessage);
        return assistantMessage;

    } catch (error) {
        console.error('Claude API Error:', error);
        return "Sorry, I had trouble processing that. Try again?";
    }
}


/* ============================================================================
   ODDS API FUNCTION
   ============================================================================ */

async function getOdds(apiKey, sport, options = {}) {
    const url = `${ODDS_API_HOST}/${ODDS_API_VERSION}/sports/${sport}/odds`;
    
    const params = {
        apiKey: apiKey,
        regions: options.regions || 'us',
        markets: options.markets || 'h2h',
        oddsFormat: options.oddsFormat || 'american',
        dateFormat: options.dateFormat || 'iso'
    };

    const response = await axios.get(url, { params, timeout: 15000 });
    
    const remaining = response.headers['x-requests-remaining'];
    console.log(`[Odds API] Quota remaining: ${remaining}`);
    
    return response.data;
}


/* ============================================================================
   KALSHI & POLYMARKET FUNCTIONS
   ============================================================================ */

/**
 * Search Kalshi for a specific game/team
 */
async function searchKalshiForGame(searchTerms) {
    try {
        const res = await axios.get('https://api.elections.kalshi.com/trade-api/v2/markets', {
            params: { limit: 500, status: 'open' },
            timeout: 10000
        });

        const markets = res.data.markets || [];
        
        // Filter for single-game markets (not parlays)
        const singleGames = markets.filter(m => {
            const ticker = (m.ticker || '').toUpperCase();
            const title = (m.title || '').toUpperCase();
            
            if (ticker.includes('MULTIGAME')) return false;
            if (ticker.includes('EXTENDED')) return false;
            if ((title.match(/YES/g) || []).length > 1) return false;
            
            return true;
        });

        // Search for matching games
        const matches = singleGames.filter(m => {
            const title = (m.title || '').toUpperCase();
            const ticker = (m.ticker || '').toUpperCase();
            
            return searchTerms.some(term => {
                if (title.includes(term) || ticker.includes(term)) return true;
                
                // Check team mappings
                const mappings = TEAM_MAPPINGS[term];
                if (mappings) {
                    return mappings.some(alias => title.includes(alias) || ticker.includes(alias));
                }
                return false;
            });
        });

        return matches;
    } catch (error) {
        console.error('[Kalshi] Error:', error.message);
        return [];
    }
}

/**
 * Search Polymarket for a specific game/team
 */
async function searchPolymarketForGame(searchTerms) {
    try {
        const res = await axios.get('https://gamma-api.polymarket.com/events', {
            params: { limit: 100, active: true, closed: false },
            timeout: 10000
        });

        const events = Array.isArray(res.data) ? res.data : [];
        
        // Filter for sports-related single games
        const sportsEvents = events.filter(e => {
            if (!e.title || !e.markets?.length) return false;
            const title = e.title.toUpperCase();
            
            // Must be sports
            const sportsKeywords = ['NBA', 'NFL', 'MLB', 'NHL', 'UFC', 'VS', 'GAME', 'BASKETBALL', 'FOOTBALL'];
            const isSports = sportsKeywords.some(kw => title.includes(kw));
            
            // Exclude futures
            const futuresKeywords = ['CHAMPION', 'MVP', 'WINNER 202', 'AWARD'];
            const isFutures = futuresKeywords.some(kw => title.includes(kw));
            
            return isSports && !isFutures;
        });

        // Search for matching games
        const matches = sportsEvents.filter(e => {
            const title = (e.title || '').toUpperCase();
            
            return searchTerms.some(term => {
                if (title.includes(term)) return true;
                
                // Check team mappings
                const mappings = TEAM_MAPPINGS[term];
                if (mappings) {
                    return mappings.some(alias => title.includes(alias));
                }
                return false;
            });
        });

        return matches;
    } catch (error) {
        console.error('[Polymarket] Error:', error.message);
        return [];
    }
}


/* ============================================================================
   BOT READY EVENT
   ============================================================================ */

client.on('ready', () => {
    console.log('');
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  ✅ BOT ONLINE: ${client.user.tag}`);
    console.log(`  📅 ${new Date().toLocaleString()}`);
    console.log('══════════════════════════════════════════════════════════');
    console.log('');
    console.log('  Environment Variables:');
    console.log(`    DISCORD_TOKEN:     ${process.env.DISCORD_TOKEN ? '✅ Set' : '❌ Missing'}`);
    console.log(`    ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log(`    ODDS_API_KEY:      ${ODDS_API_KEY ? '✅ Set (' + ODDS_API_KEY.substring(0, 8) + '...)' : '❌ Missing'}`);
    console.log('');
    console.log('  Commands: !odds, !games, !kalshi, !ask, !math, !summary, !help');
    console.log('══════════════════════════════════════════════════════════');
});


/* ============================================================================
   MESSAGE HANDLER
   ============================================================================ */

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim();
    const lowerContent = content.toLowerCase();


    /* ========================================================================
       COMMAND: !help
       ======================================================================== */
    if (lowerContent === '!help') {
        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🤖 Bot Commands')
            .addFields(
                { 
                    name: '🎰 Sports Betting', 
                    value: [
                        '`!odds [team]` - Compare odds (Kalshi/Polymarket + sportsbooks)',
                        '`!games [sport]` - Today\'s games (nba/nfl/mlb/nhl)',
                        '`!kalshi [search]` - Search Kalshi markets'
                    ].join('\n'),
                    inline: false 
                },
                { 
                    name: '💬 AI Assistant', 
                    value: [
                        '`!ask [question]` - Ask Claude anything',
                        '`!math [problem]` - Solve math step-by-step',
                        '`!summary [text]` - Summarize text'
                    ].join('\n'),
                    inline: false 
                },
                { 
                    name: '⚙️ Utility', 
                    value: '`!clear` - Clear chat memory',
                    inline: false 
                }
            )
            .setFooter({ text: 'Prediction markets + Traditional sportsbooks' });

        await message.reply({ embeds: [embed] });
        return;
    }


    /* ========================================================================
       COMMAND: !clear
       ======================================================================== */
    if (lowerContent === '!clear') {
        clearHistory(message.channel.id);
        await message.reply('🧹 Memory cleared!');
        return;
    }


    /* ========================================================================
       COMMAND: !odds [team or matchup]
       Shows Kalshi & Polymarket FIRST, then traditional sportsbooks
       ======================================================================== */
    if (lowerContent.startsWith('!odds')) {
        const query = content.slice(5).trim().toUpperCase();
        
        if (!query) {
            await message.reply('🎰 **Usage:** `!odds [team]`\n\n**Examples:**\n• `!odds bucks`\n• `!odds lakers`\n• `!odds chiefs`\n• `!odds 76ers`');
            return;
        }

        try {
            await message.channel.sendTyping();

            // Prepare search terms
            const searchTerms = query.replace(/\s+VS\s+|\s+V\s+|\s+@\s+/g, ' ').split(' ').filter(t => t.length > 2);
            
            // Add team mapping aliases to search
            const expandedTerms = [...searchTerms];
            searchTerms.forEach(term => {
                const mappings = TEAM_MAPPINGS[term];
                if (mappings) {
                    expandedTerms.push(...mappings);
                }
            });

            console.log(`[!odds] Searching for: ${expandedTerms.join(', ')}`);

            // Fetch from all sources in parallel
            const [kalshiResults, polyResults, oddsApiResults] = await Promise.all([
                searchKalshiForGame(expandedTerms),
                searchPolymarketForGame(expandedTerms),
                fetchOddsApiGames(searchTerms)
            ]);

            console.log(`[!odds] Found - Kalshi: ${kalshiResults.length}, Polymarket: ${polyResults.length}, OddsAPI: ${oddsApiResults.length}`);

            // If nothing found anywhere
            if (kalshiResults.length === 0 && polyResults.length === 0 && oddsApiResults.length === 0) {
                await message.reply(`❌ **No games found for "${query}"**\n\nTry searching for a team name like:\n• \`!odds bucks\`\n• \`!odds lakers\`\n• \`!odds chiefs\``);
                return;
            }

            // Build the embed
            const embed = new EmbedBuilder()
                .setColor(0x00FF88)
                .setTitle(`🎰 Odds: ${query}`)
                .setFooter({ text: 'Prediction Markets + Sportsbooks • Odds update frequently' });

            // ══════════════════════════════════════════════════════════════
            // KALSHI SECTION (First)
            // ══════════════════════════════════════════════════════════════
            if (kalshiResults.length > 0) {
                let kalshiText = "";
                kalshiResults.slice(0, 3).forEach(m => {
                    const yesPrice = m.yes_bid || 0;
                    const noPrice = m.no_bid || (100 - yesPrice);
                    
                    const yesOdds = centsToAmericanOdds(yesPrice);
                    const noOdds = centsToAmericanOdds(noPrice);
                    
                    const title = m.title.length > 50 ? m.title.substring(0, 49) + '...' : m.title;
                    kalshiText += `**${title}**\n`;
                    kalshiText += `└ Yes: ${yesPrice}¢ (${formatAmericanOdds(yesOdds)}) • No: ${noPrice}¢ (${formatAmericanOdds(noOdds)})\n`;
                    kalshiText += `└ Vol: $${formatVolume(m.volume)}\n\n`;
                });
                
                embed.addFields({ 
                    name: '🟣 Kalshi (Prediction Market)', 
                    value: kalshiText.substring(0, 1024), 
                    inline: false 
                });
            }

            // ══════════════════════════════════════════════════════════════
            // POLYMARKET SECTION (Second)
            // ══════════════════════════════════════════════════════════════
            if (polyResults.length > 0) {
                let polyText = "";
                polyResults.slice(0, 3).forEach(e => {
                    let yesPrice = 50;
                    if (e.markets?.[0]?.outcomePrices) {
                        try {
                            const parsed = JSON.parse(e.markets[0].outcomePrices);
                            yesPrice = Math.round(parseFloat(parsed[0] || 0.5) * 100);
                        } catch (err) {}
                    }
                    const noPrice = 100 - yesPrice;
                    
                    const yesOdds = centsToAmericanOdds(yesPrice);
                    const noOdds = centsToAmericanOdds(noPrice);
                    
                    const title = e.title.length > 50 ? e.title.substring(0, 49) + '...' : e.title;
                    polyText += `**${title}**\n`;
                    polyText += `└ Yes: ${yesPrice}¢ (${formatAmericanOdds(yesOdds)}) • No: ${noPrice}¢ (${formatAmericanOdds(noOdds)})\n`;
                    polyText += `└ Vol: $${formatVolume(e.volume)}\n\n`;
                });
                
                embed.addFields({ 
                    name: '🔵 Polymarket (Prediction Market)', 
                    value: polyText.substring(0, 1024), 
                    inline: false 
                });
            }

            // ══════════════════════════════════════════════════════════════
            // TRADITIONAL SPORTSBOOKS (Third - from The Odds API)
            // ══════════════════════════════════════════════════════════════
            if (oddsApiResults.length > 0) {
                const game = oddsApiResults[0];
                const bookmakers = game.bookmakers || [];
                
                if (bookmakers.length > 0) {
                    // Game info
                    const gameTime = new Date(game.commence_time).toLocaleString('en-US', {
                        weekday: 'short', 
                        hour: 'numeric', 
                        minute: '2-digit'
                    });
                    
                    embed.setDescription(`**${game.away_team} @ ${game.home_team}**\n📅 ${gameTime}`);

                    // Moneyline from multiple books
                    let mlText = "";
                    bookmakers.slice(0, 6).forEach(book => {
                        const h2h = book.markets.find(m => m.key === 'h2h');
                        if (h2h) {
                            const away = h2h.outcomes.find(o => o.name === game.away_team);
                            const home = h2h.outcomes.find(o => o.name === game.home_team);
                            if (away && home) {
                                const aOdds = formatAmericanOdds(away.price);
                                const hOdds = formatAmericanOdds(home.price);
                                mlText += `**${book.title}:** ${aOdds} / ${hOdds}\n`;
                            }
                        }
                    });
                    if (mlText) {
                        embed.addFields({ 
                            name: '📚 Sportsbooks - Moneyline (Away/Home)', 
                            value: mlText.substring(0, 1024), 
                            inline: false 
                        });
                    }

                    // Spread from multiple books
                    let spText = "";
                    bookmakers.slice(0, 4).forEach(book => {
                        const spread = book.markets.find(m => m.key === 'spreads');
                        if (spread) {
                            const away = spread.outcomes.find(o => o.name === game.away_team);
                            const home = spread.outcomes.find(o => o.name === game.home_team);
                            if (away && home) {
                                const aSpread = away.point > 0 ? `+${away.point}` : away.point;
                                const hSpread = home.point > 0 ? `+${home.point}` : home.point;
                                spText += `**${book.title}:** ${aSpread} / ${hSpread}\n`;
                            }
                        }
                    });
                    if (spText) {
                        embed.addFields({ 
                            name: '📊 Spread', 
                            value: spText.substring(0, 1024), 
                            inline: true 
                        });
                    }

                    // Totals
                    let totText = "";
                    bookmakers.slice(0, 4).forEach(book => {
                        const totals = book.markets.find(m => m.key === 'totals');
                        if (totals) {
                            const over = totals.outcomes.find(o => o.name === 'Over');
                            if (over) {
                                totText += `**${book.title}:** O/U ${over.point}\n`;
                            }
                        }
                    });
                    if (totText) {
                        embed.addFields({ 
                            name: '🎯 Total', 
                            value: totText.substring(0, 1024), 
                            inline: true 
                        });
                    }
                }
            }

            // If only prediction markets found (no sportsbook data)
            if (oddsApiResults.length === 0 && (kalshiResults.length > 0 || polyResults.length > 0)) {
                embed.setDescription('*Showing prediction market odds only - game not found on traditional sportsbooks*');
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!odds] Error:', error.message);
            await message.reply(`❌ Error fetching odds: ${error.message}`);
        }
        return;
    }


    /* ========================================================================
       HELPER: Fetch games from The Odds API
       ======================================================================== */
    async function fetchOddsApiGames(searchTerms) {
        if (!ODDS_API_KEY) {
            console.log('[OddsAPI] No API key');
            return [];
        }

        const sportsToSearch = [
            'basketball_nba',
            'americanfootball_nfl', 
            'baseball_mlb',
            'icehockey_nhl'
        ];

        let allGames = [];

        for (const sport of sportsToSearch) {
            try {
                const games = await getOdds(ODDS_API_KEY, sport, {
                    regions: 'us',
                    markets: 'h2h,spreads,totals',
                    oddsFormat: 'american'
                });
                
                if (games?.length) {
                    allGames = allGames.concat(games);
                }
            } catch (e) {
                // Sport not in season
            }
        }

        // Search for matching games
        const matches = allGames.filter(game => {
            const matchup = `${game.home_team} ${game.away_team}`.toUpperCase();
            return searchTerms.some(term => {
                if (matchup.includes(term)) return true;
                
                const mappings = TEAM_MAPPINGS[term];
                if (mappings) {
                    return mappings.some(alias => matchup.includes(alias));
                }
                return false;
            });
        });

        return matches;
    }


    /* ========================================================================
       COMMAND: !games [sport]
       ======================================================================== */
    if (lowerContent.startsWith('!games')) {
        const sportInput = content.slice(6).trim().toUpperCase() || 'NBA';
        
        try {
            await message.channel.sendTyping();

            if (!ODDS_API_KEY) {
                await message.reply('❌ ODDS_API_KEY not configured.');
                return;
            }

            const sportKey = SPORT_KEYS[sportInput];
            
            if (!sportKey) {
                const available = ['NBA', 'NFL', 'MLB', 'NHL', 'NCAAB', 'NCAAF', 'UFC'];
                await message.reply(`❌ Unknown sport: "${sportInput}"\n\n**Available:** ${available.join(', ')}`);
                return;
            }

            const games = await getOdds(ODDS_API_KEY, sportKey, {
                regions: 'us',
                markets: 'h2h',
                oddsFormat: 'american'
            });

            const now = new Date();
            const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000);

            const upcoming = (games || [])
                .filter(g => {
                    const gameTime = new Date(g.commence_time);
                    return gameTime >= now && gameTime <= cutoff;
                })
                .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
                .slice(0, 12);

            const embed = new EmbedBuilder()
                .setColor(0x00AA00)
                .setTitle(`🏀 ${sportInput} Games (Next 48 Hours)`)
                .setFooter({ text: 'Use !odds [team] for full odds comparison' });

            if (upcoming.length > 0) {
                let text = "";
                upcoming.forEach(g => {
                    const gameTime = new Date(g.commence_time);
                    const timeStr = gameTime.toLocaleTimeString('en-US', { 
                        weekday: 'short',
                        hour: 'numeric', 
                        minute: '2-digit'
                    });
                    
                    let oddsStr = "";
                    const book = g.bookmakers?.[0];
                    if (book) {
                        const h2h = book.markets?.find(m => m.key === 'h2h');
                        if (h2h) {
                            const away = h2h.outcomes.find(o => o.name === g.away_team);
                            const home = h2h.outcomes.find(o => o.name === g.home_team);
                            if (away && home) {
                                oddsStr = ` (${formatAmericanOdds(away.price)}/${formatAmericanOdds(home.price)})`;
                            }
                        }
                    }
                    
                    text += `**${timeStr}** • ${g.away_team} @ ${g.home_team}${oddsStr}\n`;
                });
                embed.setDescription(text);
            } else {
                embed.setDescription(`No ${sportInput} games in the next 48 hours.`);
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!games] Error:', error.message);
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }


    /* ========================================================================
       COMMAND: !kalshi [search]
       ======================================================================== */
    if (lowerContent.startsWith('!kalshi')) {
        const query = content.slice(7).trim().toUpperCase();
        
        try {
            await message.channel.sendTyping();

            const res = await axios.get('https://api.elections.kalshi.com/trade-api/v2/markets', {
                params: { limit: 500, status: 'open' },
                timeout: 10000
            });

            const markets = res.data.markets || [];

            const singleMarkets = markets.filter(m => {
                const ticker = (m.ticker || '').toUpperCase();
                const title = (m.title || '').toUpperCase();
                
                if (ticker.includes('MULTIGAME')) return false;
                if (ticker.includes('EXTENDED')) return false;
                if ((title.match(/YES/g) || []).length > 1) return false;
                
                return true;
            });

            let filtered = singleMarkets;

            if (query) {
                const terms = query.split(' ').filter(t => t.length > 1);
                filtered = singleMarkets.filter(m => {
                    const text = `${m.title} ${m.category} ${m.ticker}`.toUpperCase();
                    return terms.some(term => text.includes(term));
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
                .setFooter({ text: 'Source: Kalshi' });

            if (filtered.length > 0) {
                let text = "";
                filtered.forEach(m => {
                    const yesPrice = m.yes_bid || 0;
                    const noPrice = m.no_bid || (100 - yesPrice);
                    const yesOdds = centsToAmericanOdds(yesPrice);
                    const noOdds = centsToAmericanOdds(noPrice);
                    
                    const closeTime = new Date(m.close_time);
                    const hoursLeft = Math.round((closeTime - now) / (1000 * 60 * 60));
                    const timeStr = hoursLeft > 48 ? `${Math.round(hoursLeft/24)}d` : `${hoursLeft}h`;
                    
                    const title = m.title.length > 50 ? m.title.substring(0, 49) + '...' : m.title;
                    text += `**${title}**\n`;
                    text += `└ Yes: ${yesPrice}¢ (${formatAmericanOdds(yesOdds)}) • No: ${noPrice}¢ (${formatAmericanOdds(noOdds)})\n`;
                    text += `└ ⏰ ${timeStr} • Vol: $${formatVolume(m.volume)}\n\n`;
                });
                embed.setDescription(text);
            } else {
                embed.setDescription(query 
                    ? `No markets found for "${query}"`
                    : 'No markets found.');
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!kalshi] Error:', error.message);
            await message.reply('❌ Error fetching Kalshi markets.');
        }
        return;
    }


    /* ========================================================================
       COMMAND: !math [problem]
       ======================================================================== */
    if (lowerContent.startsWith('!math ')) {
        const problem = content.slice(6).trim();
        
        if (!problem) {
            await message.reply('🔢 Example: `!math 25 * 4 + 10`');
            return;
        }

        try {
            await message.channel.sendTyping();

            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: [{ role: 'user', content: `Solve step-by-step, be concise:\n${problem}` }],
            });

            const answer = response.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n\n');

            await sendResponse(message, answer);

        } catch (error) {
            console.error('[!math] Error:', error);
            await message.reply('❌ Error solving problem.');
        }
        return;
    }


    /* ========================================================================
       COMMAND: !summary [text]
       ======================================================================== */
    if (lowerContent.startsWith('!summary ')) {
        const text = content.slice(9).trim();
        
        if (!text) {
            await message.reply('📝 Example: `!summary [paste text here]`');
            return;
        }

        try {
            await message.channel.sendTyping();

            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: [{ role: 'user', content: `Summarize concisely with bullet points:\n${text}` }],
            });

            const summary = response.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n\n');

            await sendResponse(message, summary);

        } catch (error) {
            console.error('[!summary] Error:', error);
            await message.reply('❌ Error generating summary.');
        }
        return;
    }


    /* ========================================================================
       COMMAND: !ask [question]
       ======================================================================== */
    if (lowerContent.startsWith('!ask ')) {
        const question = content.slice(5).trim();
        
        if (!question) {
            await message.reply('❓ Example: `!ask What is the capital of France?`');
            return;
        }

        const response = await chatWithClaude(message.channel.id, question);
        await sendResponse(message, response);
        return;
    }


    /* ========================================================================
       MENTION HANDLER
       ======================================================================== */
    if (message.mentions.has(client.user)) {
        const question = content.replace(/<@!?\d+>/g, '').trim();
        
        if (question) {
            const response = await chatWithClaude(message.channel.id, question);
            await sendResponse(message, response);
        } else {
            await message.reply('👋 Ask me something!');
        }
        return;
    }
});


/* ============================================================================
   STARTUP
   ============================================================================ */

console.log('');
console.log('🚀 Starting bot...');
console.log('');
console.log('Checking environment variables...');
console.log(`  DISCORD_TOKEN: ${process.env.DISCORD_TOKEN ? 'Present' : 'MISSING'}`);
console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'Present' : 'MISSING'}`);
console.log(`  ODDS_API_KEY: ${ODDS_API_KEY ? 'Present (' + ODDS_API_KEY.substring(0, 8) + '...)' : 'MISSING'}`);
console.log('');

client.login(process.env.DISCORD_TOKEN);