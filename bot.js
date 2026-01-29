/**
 * ============================================================================
 * DISCORD BOT - SPORTS BETTING & AI ASSISTANT
 * ============================================================================
 * 
 * Commands:
 *   !odds [team]       - Compare odds across sportsbooks
 *   !games [sport]     - List today's games with odds
 *   !kalshi [search]   - Search Kalshi prediction markets
 *   !ask [question]    - Ask Claude AI (with web search)
 *   !math [problem]    - Step-by-step math solver
 *   !summary [text]    - Summarize long text
 *   !clear             - Clear conversation memory
 *   !help              - Show all commands
 * 
 * API References:
 *   The Odds API v4: https://the-odds-api.com/liveapi/guides/v4/
 *   Host: https://api.the-odds-api.com
 * 
 * Required Environment Variables:
 *   DISCORD_TOKEN      - Discord bot token
 *   ANTHROPIC_API_KEY  - Claude API key
 *   ODDS_API_KEY       - The Odds API key (get free at https://the-odds-api.com)
 * 
 * ============================================================================
 */

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
require('dotenv').config();


/* ============================================================================
   CONFIGURATION
   ============================================================================ */

// The Odds API Configuration (per documentation)
const ODDS_API_HOST = 'https://api.the-odds-api.com';
const ODDS_API_VERSION = 'v4';

// Supported sports keys (from /v4/sports endpoint per docs)
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
    'COLLEGE BASKETBALL': 'basketball_ncaab',
    'NCAAF': 'americanfootball_ncaaf',
    'CFB': 'americanfootball_ncaaf',
    'COLLEGE FOOTBALL': 'americanfootball_ncaaf',
    'UFC': 'mma_mixed_martial_arts',
    'MMA': 'mma_mixed_martial_arts',
    'SOCCER': 'soccer_usa_mls',
    'MLS': 'soccer_usa_mls',
    'EPL': 'soccer_epl',
    'PREMIER LEAGUE': 'soccer_epl'
};

// Claude AI Configuration
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
   THE ODDS API FUNCTIONS
   Following documentation at: https://the-odds-api.com/liveapi/guides/v4/
   ============================================================================ */

/**
 * GET /v4/sports/{sport}/odds - Returns odds for a sport
 * 
 * Parameters (per docs):
 * - sport: Sport key from /sports endpoint
 * - apiKey: API key
 * - regions: Bookmaker regions (us, uk, eu, au)
 * - markets: h2h (moneyline), spreads, totals, outrights
 * - oddsFormat: decimal or american
 * - dateFormat: iso or unix
 * 
 * Usage quota: 1 per region per market
 */
async function getOdds(apiKey, sport, options = {}) {
    const url = `${ODDS_API_HOST}/${ODDS_API_VERSION}/sports/${sport}/odds`;
    
    const params = {
        apiKey: apiKey,
        regions: options.regions || 'us',
        markets: options.markets || 'h2h',
        oddsFormat: options.oddsFormat || 'american',
        dateFormat: options.dateFormat || 'iso'
    };

    console.log(`[Odds API] Requesting: ${url}`);
    console.log(`[Odds API] Params: regions=${params.regions}, markets=${params.markets}`);

    const response = await axios.get(url, { 
        params: params, 
        timeout: 15000 
    });
    
    // Log usage from response headers (per docs)
    const remaining = response.headers['x-requests-remaining'];
    const used = response.headers['x-requests-used'];
    const last = response.headers['x-requests-last'];
    console.log(`[Odds API] Quota - Remaining: ${remaining}, Used: ${used}, Last Cost: ${last}`);
    
    return response.data;
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
    console.log(`    DISCORD_TOKEN:    ${process.env.DISCORD_TOKEN ? '✅ Set' : '❌ Missing'}`);
    console.log(`    ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Missing'}`);
    console.log(`    ODDS_API_KEY:      ${process.env.ODDS_API_KEY ? '✅ Set (' + process.env.ODDS_API_KEY.substring(0, 8) + '...)' : '❌ Missing'}`);
    console.log('');
    console.log('  Commands: !odds, !games, !kalshi, !ask, !math, !summary, !help');
    console.log('══════════════════════════════════════════════════════════');
    console.log('');
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
                        '`!odds [team]` - Compare odds across books',
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
            .setFooter({ text: 'Odds via The Odds API • AI by Claude' });

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
       
       Uses The Odds API v4 /odds endpoint
       GET /v4/sports/{sport}/odds/?apiKey={apiKey}&regions={regions}&markets={markets}
       ======================================================================== */
    if (lowerContent.startsWith('!odds')) {
        const query = content.slice(5).trim().toUpperCase();
        
        if (!query) {
            await message.reply('🎰 **Usage:** `!odds [team]`\n\n**Examples:**\n• `!odds bucks`\n• `!odds lakers`\n• `!odds chiefs`\n• `!odds yankees`');
            return;
        }

        try {
            await message.channel.sendTyping();

            // Get API key from environment
            const apiKey = process.env.ODDS_API_KEY;
            
            console.log(`[!odds] API Key present: ${apiKey ? 'Yes (' + apiKey.substring(0, 8) + '...)' : 'No'}`);
            
            if (!apiKey) {
                await message.reply('❌ **ODDS_API_KEY not configured**\n\n1. Get a free API key at: https://the-odds-api.com/#get-access\n2. Add it to Railway → Variables → `ODDS_API_KEY`\n3. Redeploy the bot');
                return;
            }

            // Sports to search (using correct keys from docs)
            const sportsToSearch = [
                'basketball_nba',
                'americanfootball_nfl', 
                'baseball_mlb',
                'icehockey_nhl',
                'basketball_ncaab',
                'americanfootball_ncaaf',
                'mma_mixed_martial_arts'
            ];

            let allGames = [];
            let apiErrors = [];

            // Fetch odds from each sport
            for (const sport of sportsToSearch) {
                try {
                    console.log(`[!odds] Fetching ${sport}...`);
                    const games = await getOdds(apiKey, sport, {
                        regions: 'us',
                        markets: 'h2h,spreads,totals',
                        oddsFormat: 'american'
                    });
                    
                    if (games && games.length > 0) {
                        console.log(`[!odds] ${sport}: Found ${games.length} games`);
                        allGames = allGames.concat(games);
                    } else {
                        console.log(`[!odds] ${sport}: No games`);
                    }
                } catch (e) {
                    const status = e.response?.status;
                    const msg = e.response?.data?.message || e.message;
                    console.log(`[!odds] ${sport} error: ${status} - ${msg}`);
                    
                    if (status === 401) {
                        apiErrors.push('Invalid API key');
                    } else if (status === 429) {
                        apiErrors.push('Rate limited');
                    }
                }
            }

            // Check for API errors
            if (apiErrors.includes('Invalid API key')) {
                await message.reply('❌ **Invalid API Key**\n\nYour ODDS_API_KEY is incorrect. Please check it at:\nhttps://the-odds-api.com/account/');
                return;
            }

            console.log(`[!odds] Total games fetched: ${allGames.length}`);

            if (allGames.length === 0) {
                await message.reply('❌ Could not fetch odds data. No games currently available or API issue.\n\nTry `!games nba` to see available games.');
                return;
            }

            // Search for matching games by team name
            const searchTerms = query
                .replace(/\s+VS\s+|\s+V\s+|\s+@\s+/g, ' ')
                .split(' ')
                .filter(t => t.length > 2);
            
            const matches = allGames.filter(game => {
                const matchup = `${game.home_team} ${game.away_team}`.toUpperCase();
                return searchTerms.some(term => matchup.includes(term));
            });

            console.log(`[!odds] Search "${query}" found ${matches.length} matches`);

            if (matches.length === 0) {
                // Show upcoming games so user knows what's available
                const now = new Date();
                const upcoming = allGames
                    .filter(g => new Date(g.commence_time) > now)
                    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
                    .slice(0, 10);

                let text = `❌ **No games found for "${query}"**\n\n`;
                if (upcoming.length > 0) {
                    text += '**Available games:**\n';
                    upcoming.forEach(g => {
                        const time = new Date(g.commence_time).toLocaleTimeString('en-US', { 
                            hour: 'numeric', 
                            minute: '2-digit',
                            timeZoneName: 'short'
                        });
                        text += `• ${g.away_team} @ ${g.home_team} (${time})\n`;
                    });
                    text += '\n*Search for one of these teams*';
                }
                await message.reply(text);
                return;
            }

            // Use the first matching game
            const game = matches[0];
            const gameTime = new Date(game.commence_time).toLocaleString('en-US', {
                weekday: 'short', 
                month: 'short', 
                day: 'numeric', 
                hour: 'numeric', 
                minute: '2-digit',
                timeZoneName: 'short'
            });

            // Build embed with odds from multiple bookmakers
            const embed = new EmbedBuilder()
                .setColor(0xFF6B00)
                .setTitle(`🏀 ${game.away_team} @ ${game.home_team}`)
                .setDescription(`📅 ${gameTime}`)
                .setFooter({ text: 'Source: The Odds API • Lines update frequently' });

            const bookmakers = game.bookmakers || [];

            if (bookmakers.length === 0) {
                embed.addFields({ 
                    name: 'No Odds Available', 
                    value: 'Bookmakers have not posted lines yet.', 
                    inline: false 
                });
            } else {
                // MONEYLINE (h2h market per docs)
                let mlText = "";
                bookmakers.slice(0, 8).forEach(book => {
                    const h2h = book.markets.find(m => m.key === 'h2h');
                    if (h2h) {
                        const away = h2h.outcomes.find(o => o.name === game.away_team);
                        const home = h2h.outcomes.find(o => o.name === game.home_team);
                        if (away && home) {
                            const aOdds = away.price > 0 ? `+${away.price}` : away.price;
                            const hOdds = home.price > 0 ? `+${home.price}` : home.price;
                            mlText += `**${book.title}:** ${aOdds} / ${hOdds}\n`;
                        }
                    }
                });
                if (mlText) {
                    embed.addFields({ 
                        name: '💰 Moneyline (Away / Home)', 
                        value: mlText.substring(0, 1024), 
                        inline: false 
                    });
                }

                // SPREAD (spreads market per docs)
                let spText = "";
                bookmakers.slice(0, 8).forEach(book => {
                    const spread = book.markets.find(m => m.key === 'spreads');
                    if (spread) {
                        const away = spread.outcomes.find(o => o.name === game.away_team);
                        const home = spread.outcomes.find(o => o.name === game.home_team);
                        if (away && home) {
                            const aSpread = away.point > 0 ? `+${away.point}` : away.point;
                            const hSpread = home.point > 0 ? `+${home.point}` : home.point;
                            const aPrice = away.price > 0 ? `+${away.price}` : away.price;
                            const hPrice = home.price > 0 ? `+${home.price}` : home.price;
                            spText += `**${book.title}:** ${aSpread} (${aPrice}) / ${hSpread} (${hPrice})\n`;
                        }
                    }
                });
                if (spText) {
                    embed.addFields({ 
                        name: '📊 Spread (Away / Home)', 
                        value: spText.substring(0, 1024), 
                        inline: false 
                    });
                }

                // TOTALS (totals market per docs)
                let totText = "";
                bookmakers.slice(0, 8).forEach(book => {
                    const totals = book.markets.find(m => m.key === 'totals');
                    if (totals) {
                        const over = totals.outcomes.find(o => o.name === 'Over');
                        const under = totals.outcomes.find(o => o.name === 'Under');
                        if (over && under) {
                            const oPrice = over.price > 0 ? `+${over.price}` : over.price;
                            const uPrice = under.price > 0 ? `+${under.price}` : under.price;
                            totText += `**${book.title}:** O/U ${over.point} (O: ${oPrice} / U: ${uPrice})\n`;
                        }
                    }
                });
                if (totText) {
                    embed.addFields({ 
                        name: '🎯 Total (Over/Under)', 
                        value: totText.substring(0, 1024), 
                        inline: false 
                    });
                }
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!odds] Error:', error.message);
            console.error('[!odds] Full error:', error);
            
            // Handle specific API errors per docs
            if (error.response?.status === 401) {
                await message.reply('❌ **Invalid API key**\n\nCheck your ODDS_API_KEY in Railway Variables.');
            } else if (error.response?.status === 429) {
                await message.reply('❌ **Rate limited**\n\nPlease wait a moment and try again.');
            } else if (error.response?.status === 422) {
                await message.reply('❌ **Invalid request**\n\nThere was an issue with the API request.');
            } else {
                await message.reply(`❌ Error fetching odds: ${error.message}`);
            }
        }
        return;
    }


    /* ========================================================================
       COMMAND: !games [sport]
       
       Uses The Odds API v4 /odds endpoint to list games
       Default sport: NBA
       ======================================================================== */
    if (lowerContent.startsWith('!games')) {
        const sportInput = content.slice(6).trim().toUpperCase() || 'NBA';
        
        try {
            await message.channel.sendTyping();

            const apiKey = process.env.ODDS_API_KEY;
            
            console.log(`[!games] API Key present: ${apiKey ? 'Yes' : 'No'}`);
            
            if (!apiKey) {
                await message.reply('❌ **ODDS_API_KEY not configured**\n\n1. Get a free API key at: https://the-odds-api.com/#get-access\n2. Add it to Railway → Variables → `ODDS_API_KEY`\n3. Redeploy the bot');
                return;
            }

            // Map user input to API sport key
            const sportKey = SPORT_KEYS[sportInput];
            
            if (!sportKey) {
                const available = ['NBA', 'NFL', 'MLB', 'NHL', 'NCAAB', 'NCAAF', 'UFC', 'MLS', 'EPL'];
                await message.reply(`❌ Unknown sport: "${sportInput}"\n\n**Available:** ${available.join(', ')}`);
                return;
            }

            console.log(`[!games] Fetching ${sportKey}...`);

            // Fetch odds for the sport (h2h only to save quota)
            const games = await getOdds(apiKey, sportKey, {
                regions: 'us',
                markets: 'h2h',
                oddsFormat: 'american'
            });

            const now = new Date();
            const cutoff = new Date(now.getTime() + 48 * 60 * 60 * 1000); // Next 48 hours

            // Filter and sort upcoming games
            const upcoming = (games || [])
                .filter(g => {
                    const gameTime = new Date(g.commence_time);
                    return gameTime >= now && gameTime <= cutoff;
                })
                .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
                .slice(0, 12);

            console.log(`[!games] Found ${upcoming.length} upcoming games`);

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
                    
                    // Get first bookmaker's moneyline odds
                    let oddsStr = "";
                    const book = g.bookmakers?.[0];
                    if (book) {
                        const h2h = book.markets?.find(m => m.key === 'h2h');
                        if (h2h) {
                            const away = h2h.outcomes.find(o => o.name === g.away_team);
                            const home = h2h.outcomes.find(o => o.name === g.home_team);
                            if (away && home) {
                                const a = away.price > 0 ? `+${away.price}` : away.price;
                                const h = home.price > 0 ? `+${home.price}` : home.price;
                                oddsStr = ` (${a}/${h})`;
                            }
                        }
                    }
                    
                    text += `**${timeStr}** • ${g.away_team} @ ${g.home_team}${oddsStr}\n`;
                });
                embed.setDescription(text);
            } else {
                embed.setDescription(`No ${sportInput} games scheduled in the next 48 hours.\n\nThe sport may be out of season, or games haven't been posted yet.`);
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!games] Error:', error.message);
            
            if (error.response?.status === 401) {
                await message.reply('❌ **Invalid API key**\n\nCheck your ODDS_API_KEY in Railway Variables.');
            } else if (error.response?.status === 404) {
                await message.reply(`❌ Sport "${sportInput}" not found or not in season.`);
            } else {
                await message.reply(`❌ Error fetching games: ${error.message}`);
            }
        }
        return;
    }


    /* ========================================================================
       COMMAND: !kalshi [search]
       Search Kalshi prediction markets
       ======================================================================== */
    if (lowerContent.startsWith('!kalshi')) {
        const query = content.slice(7).trim().toUpperCase();
        
        try {
            await message.channel.sendTyping();

            // Fetch Kalshi markets
            const res = await axios.get('https://api.elections.kalshi.com/trade-api/v2/markets', {
                params: { limit: 500, status: 'open' },
                timeout: 10000
            });

            const markets = res.data.markets || [];
            console.log(`[!kalshi] Fetched ${markets.length} markets`);

            // Filter out multi-game parlays
            const singleMarkets = markets.filter(m => {
                const ticker = (m.ticker || '').toUpperCase();
                const title = (m.title || '').toUpperCase();
                
                if (ticker.includes('MULTIGAME')) return false;
                if (ticker.includes('EXTENDED')) return false;
                if ((title.match(/YES/g) || []).length > 1) return false;
                
                return true;
            });

            let filtered = singleMarkets;

            // Search if query provided
            if (query) {
                const terms = query.split(' ').filter(t => t.length > 1);
                filtered = singleMarkets.filter(m => {
                    const text = `${m.title} ${m.category} ${m.ticker}`.toUpperCase();
                    return terms.some(term => text.includes(term));
                });
            }

            // Sort by volume
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
                    const yes = m.yes_bid ? `$${(m.yes_bid / 100).toFixed(2)}` : '—';
                    const no = m.no_bid ? `$${(m.no_bid / 100).toFixed(2)}` : '—';
                    const closeTime = new Date(m.close_time);
                    const hoursLeft = Math.round((closeTime - now) / (1000 * 60 * 60));
                    const timeStr = hoursLeft > 48 ? `${Math.round(hoursLeft/24)}d` : `${hoursLeft}h`;
                    
                    const title = m.title.length > 50 ? m.title.substring(0, 49) + '...' : m.title;
                    text += `**${title}**\n`;
                    text += `└ Yes: ${yes} • No: ${no} • ⏰ ${timeStr} • Vol: $${formatVolume(m.volume)}\n\n`;
                });
                embed.setDescription(text);
            } else {
                embed.setDescription(query 
                    ? `No markets found for "${query}"\n\nTry: \`!kalshi weather\`, \`!kalshi inflation\`, \`!kalshi fed\``
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
                messages: [{ 
                    role: 'user', 
                    content: `Solve step-by-step, be concise:\n${problem}` 
                }],
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
                messages: [{ 
                    role: 'user', 
                    content: `Summarize concisely with bullet points:\n${text}` 
                }],
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

// Log environment variable status at startup
console.log('Checking environment variables...');
console.log(`  DISCORD_TOKEN: ${process.env.DISCORD_TOKEN ? 'Present' : 'MISSING'}`);
console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? 'Present' : 'MISSING'}`);
console.log(`  ODDS_API_KEY: ${process.env.ODDS_API_KEY ? 'Present (' + process.env.ODDS_API_KEY.substring(0, 8) + '...)' : 'MISSING'}`);
console.log('');

client.login(process.env.DISCORD_TOKEN);