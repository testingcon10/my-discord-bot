/**
 * ============================================================================
 * DISCORD BOT APPLICATION
 * ============================================================================
 * 
 * Features:
 *   - Claude AI integration with web search
 *   - Kalshi market lookup
 *   - Live sports markets (24h, no futures, no parlays)
 *   - Math solver
 *   - Text summarizer
 *   - Conversation memory
 * 
 * Commands:
 *   !ask [question]    - Ask Claude anything (with web search)
 *   !sports            - Live sports markets (next 24 hours)
 *   !kalshi [ticker]   - Lookup specific Kalshi market
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


/* ============================================================================
   CONFIGURATION
   ============================================================================ */

const SYSTEM_PROMPT = `You are a smart, witty AI assistant in a Discord server.
You're talking to people in their 20s, so:
- Be direct and to the point, like a coworker
- Don't over-explain or be condescending
- Use emojis sparingly, only when it adds to the vibe
- Keep responses concise but informative
- It's fine to say "I don't know" or suggest they Google something obscure`;

const HISTORY_LIMIT = 20;


/* ============================================================================
   DISCORD CLIENT SETUP
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


/* ============================================================================
   ANTHROPIC CLIENT SETUP
   ============================================================================ */

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});


/* ============================================================================
   CONVERSATION HISTORY MANAGEMENT
   ============================================================================ */

const conversationHistory = new Map();

function getConversationHistory(channelId) {
    if (!conversationHistory.has(channelId)) {
        conversationHistory.set(channelId, []);
    }
    return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
    const history = getConversationHistory(channelId);
    history.push({ role, content });
    if (history.length > HISTORY_LIMIT) {
        history.shift();
    }
}

function clearHistory(channelId) {
    conversationHistory.set(channelId, []);
}


/* ============================================================================
   HELPER FUNCTIONS
   ============================================================================ */

/**
 * Send a response with typing indicator, splitting long messages if needed
 */
async function sendResponseWithTyping(message, response) {
    await message.channel.sendTyping();
    
    if (response.length <= 2000) {
        await message.reply(response);
    } else {
        // Split into chunks for Discord's 2000 char limit
        const chunks = response.match(/.{1,1900}/gs) || [];
        for (let i = 0; i < chunks.length; i++) {
            if (i === 0) {
                await message.reply(chunks[i]);
            } else {
                await message.channel.send(chunks[i]);
            }
        }
    }
}

/**
 * Format large numbers (1000 -> 1k, 1000000 -> 1M)
 */
function formatVolume(num) {
    if (!num) return "0";
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
    return num.toString();
}

/**
 * Chat with Claude AI (includes web search capability)
 */
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

        // Extract text from response (handles web search responses too)
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
   BOT READY EVENT
   ============================================================================ */

client.once('ready', () => {
    console.log('══════════════════════════════════════════════════════════');
    console.log(`  ✅ BOT ONLINE: ${client.user.tag}`);
    console.log(`  📅 Started: ${new Date().toLocaleString()}`);
    console.log('══════════════════════════════════════════════════════════');
    console.log('  Available Commands:');
    console.log('    !ask      - Ask Claude (with web search)');
    console.log('    !sports   - Live sports markets (24h)');
    console.log('    !kalshi   - Lookup Kalshi ticker');
    console.log('    !math     - Math solver');
    console.log('    !summary  - Summarize text');
    console.log('    !clear    - Clear memory');
    console.log('    !help     - Show commands');
    console.log('══════════════════════════════════════════════════════════');
});


/* ============================================================================
   MESSAGE HANDLER
   ============================================================================ */

client.on('messageCreate', async (message) => {
    // Ignore bot messages
    if (message.author.bot) return;

    const content = message.content.trim();
    const lowerContent = content.toLowerCase();


    /* ========================================================================
       COMMAND: !clear
       ======================================================================== */
    if (lowerContent === '!clear') {
        clearHistory(message.channel.id);
        await message.reply('🧹 Memory cleared! Starting fresh.');
        return;
    }


    /* ========================================================================
       COMMAND: !help
       ======================================================================== */
    if (lowerContent === '!help') {
        const helpEmbed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setTitle('🤖 Bot Commands')
            .setDescription('Here\'s everything I can do:')
            .addFields(
                { 
                    name: '💬 Chat', 
                    value: '`!ask [question]` - Ask me anything\n`@mention` - Mention me to chat', 
                    inline: false 
                },
                { 
                    name: '📊 Markets', 
                    value: '`!sports` - Live sports markets (24h)\n`!kalshi [ticker]` - Lookup specific market', 
                    inline: false 
                },
                { 
                    name: '🛠️ Tools', 
                    value: '`!math [problem]` - Solve math step-by-step\n`!summary [text]` - Summarize long text', 
                    inline: false 
                },
                { 
                    name: '⚙️ Utility', 
                    value: '`!clear` - Clear conversation memory\n`!help` - Show this menu', 
                    inline: false 
                }
            )
            .setFooter({ text: 'Powered by Claude AI' });

        await message.reply({ embeds: [helpEmbed] });
        return;
    }


    /* ========================================================================
       COMMAND: !kalshi [ticker]
       ======================================================================== */
    if (lowerContent.startsWith('!kalshi ')) {
        const ticker = content.slice(8).trim().toUpperCase();
        
        if (!ticker) {
            await message.reply("📊 Please provide a ticker. Example: `!kalshi KXHIGHNY`");
            return;
        }

        try {
            await message.channel.sendTyping();
            
            const url = `https://api.elections.kalshi.com/trade-api/v2/markets/${ticker}`;
            const response = await axios.get(url);
            const market = response.data.market;

            const embed = new EmbedBuilder()
                .setColor(0x00D166)
                .setTitle(`📊 ${market.title}`)
                .addFields(
                    { name: 'Ticker', value: market.ticker, inline: true },
                    { name: 'Yes Price', value: `$${(market.yes_bid / 100).toFixed(2)}`, inline: true },
                    { name: 'No Price', value: `$${(market.no_ask / 100).toFixed(2)}`, inline: true },
                    { name: 'Status', value: market.status, inline: true },
                    { name: 'Closes', value: new Date(market.close_time).toLocaleString(), inline: true }
                )
                .setFooter({ text: 'Source: Kalshi' });

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Kalshi API Error:', error.message);
            await message.reply("❌ Couldn't find that market. Check the ticker and try again.");
        }
        return;
    }


/* ========================================================================
       COMMAND: !sports
       Live sports markets - Next 24 hours only, no futures, no parlays
       ======================================================================== */
    if (lowerContent === '!sports') {
        try {
            await message.channel.sendTyping();

            // ─────────────────────────────────────────────────────────────────
            // FETCH DATA FROM BOTH APIs
            // ─────────────────────────────────────────────────────────────────
            
            const fetchKalshi = axios.get('https://api.elections.kalshi.com/trade-api/v2/markets?limit=500&status=open')
                .then(res => res.data.markets || [])
                .catch(err => { 
                    console.error("Kalshi API Failed:", err.message); 
                    return []; 
                });

            const fetchPoly = axios.get('https://gamma-api.polymarket.com/events?limit=100&active=true&closed=false')
                .then(res => Array.isArray(res.data) ? res.data : [])
                .catch(err => { 
                    console.error("Polymarket API Failed:", err.message); 
                    return []; 
                });

            const [kalshiData, polyData] = await Promise.all([fetchKalshi, fetchPoly]);

            console.log(`[!sports] Fetched ${kalshiData.length} Kalshi, ${polyData.length} Polymarket`);

            // ─────────────────────────────────────────────────────────────────
            // TIME FILTERS - STRICT 24 HOURS ONLY
            // ─────────────────────────────────────────────────────────────────
            
            const now = new Date();
            const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);

            // ─────────────────────────────────────────────────────────────────
            // KEYWORD DEFINITIONS
            // ─────────────────────────────────────────────────────────────────

            // Sports identifiers
            const sportsKeywords = [
                'NFL', 'NBA', 'UFC', 'MLB', 'NHL', 'NCAA', 'MLS', 'WNBA',
                'FOOTBALL', 'BASKETBALL', 'BASEBALL', 'HOCKEY', 'SOCCER',
                'MMA', 'BOXING', 'TENNIS', 'GOLF',
                'PREMIER LEAGUE', 'CHAMPIONS LEAGUE', 'LA LIGA', 'SERIE A',
                'LAKERS', 'CELTICS', 'WARRIORS', 'BULLS', 'HEAT', 'KNICKS', 'NETS', 'SUNS', 'BUCKS', 'NUGGETS',
                'CHIEFS', 'EAGLES', 'COWBOYS', 'PACKERS', '49ERS', 'RAVENS', 'BILLS', 'BENGALS',
                'YANKEES', 'DODGERS', 'RED SOX', 'METS', 'CUBS', 'ASTROS', 'BRAVES',
                'VS', 'VERSUS', 'GAME'
            ];

            // FUTURES - These words mean it's a long-term bet (EXCLUDE)
            const futuresPatterns = [
                /WINNER$/i,                    // Ends with "Winner"
                /CHAMPION/i,                   // Any champion
                /MVP/i,                        // MVP awards
                /ROOKIE OF THE YEAR/i,
                /DEFENSIVE PLAYER/i,
                /AWARD/i,
                /WIN THE 202/i,                // "Win the 2025"
                /202[5-9].*WINNER/i,           // "2025 Winner"
                /WINNER.*202[5-9]/i,           // "Winner 2025"
                /SEASON/i,
                /CHAMPIONSHIP$/i,              // Ends with "Championship"
                /PREMIER LEAGUE WINNER/i,
                /CHAMPIONS LEAGUE WINNER/i,
                /LA LIGA WINNER/i,
                /SERIE A WINNER/i,
                /SUPER BOWL WINNER/i,
                /WORLD SERIES WINNER/i,
                /STANLEY CUP WINNER/i,
                /NBA.*WINNER/i,
                /NFL.*WINNER/i,
                /HALL OF FAME/i,
                /RETIRE/i,
                /DRAFT/i,
                /ALL.?STAR/i
            ];

            // Parlay patterns (EXCLUDE)
            const parlayPatterns = [
                /\d\+/,              // "2+", "3+", etc.
                /PARLAY/i,
                /COMBO/i
            ];

            // ─────────────────────────────────────────────────────────────────
            // HELPER: Check if market is a futures bet
            // ─────────────────────────────────────────────────────────────────
            
            function isFuturesBet(title) {
                return futuresPatterns.some(pattern => pattern.test(title));
            }

            function isParlay(title) {
                return parlayPatterns.some(pattern => pattern.test(title));
            }

            function isSportsRelated(title, category = '') {
                const text = (title + ' ' + category).toUpperCase();
                return sportsKeywords.some(kw => text.includes(kw));
            }

            // ─────────────────────────────────────────────────────────────────
            // PROCESS KALSHI DATA - STRICT 24H ONLY
            // ─────────────────────────────────────────────────────────────────

            const kalshiSports = kalshiData
                .filter(m => {
                    if (!m.title || !m.close_time) return false;
                    
                    const closeTime = new Date(m.close_time);
                    
                    // STRICT: Must close within 24 hours
                    if (closeTime > in24Hours || closeTime < now) return false;
                    
                    // Must be sports
                    if (!isSportsRelated(m.title, m.category)) return false;
                    
                    // No futures
                    if (isFuturesBet(m.title)) return false;
                    
                    // No parlays
                    if (isParlay(m.title)) return false;
                    
                    // Must have volume
                    if ((m.volume || 0) <= 0) return false;
                    
                    return true;
                })
                .sort((a, b) => (b.volume_24h || b.volume || 0) - (a.volume_24h || a.volume || 0))
                .slice(0, 4);

            console.log(`[!sports] Kalshi 24h sports: ${kalshiSports.length}`);

            // ─────────────────────────────────────────────────────────────────
            // PROCESS POLYMARKET DATA - STRICT 24H ONLY
            // ─────────────────────────────────────────────────────────────────

            const polySports = polyData
                .filter(e => {
                    if (!e.title || !e.markets?.length) return false;
                    
                    // Must be sports
                    if (!isSportsRelated(e.title, '')) return false;
                    
                    // No futures
                    if (isFuturesBet(e.title)) return false;
                    
                    // No parlays
                    if (isParlay(e.title)) return false;

                    // STRICT: Check if ANY market closes within 24h
                    const hasShortTermMarket = e.markets.some(m => {
                        if (!m.endDate) return false;
                        const closeTime = new Date(m.endDate);
                        return closeTime <= in24Hours && closeTime > now;
                    });
                    
                    return hasShortTermMarket;
                })
                .sort((a, b) => (b.volume || 0) - (a.volume || 0))
                .slice(0, 4);

            console.log(`[!sports] Polymarket 24h sports: ${polySports.length}`);

            // ─────────────────────────────────────────────────────────────────
            // BUILD DISCORD EMBED
            // ─────────────────────────────────────────────────────────────────

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🏈 Live Sports Markets (Next 24 Hours)')
                .setDescription('Props, spreads & game outcomes • No futures • Sorted by volume')
                .setFooter({ text: `Updated: ${now.toLocaleTimeString()}` });

            // Kalshi Column
            let kalshiText = "";
            if (kalshiSports.length > 0) {
                kalshiSports.forEach(m => {
                    const yesPrice = m.yes_bid ? (m.yes_bid / 100).toFixed(2) : "-.--";
                    const volume = m.volume_24h || m.volume || 0;
                    const closeTime = new Date(m.close_time);
                    const hoursLeft = Math.max(0, Math.round((closeTime - now) / (1000 * 60 * 60)));
                    
                    const shortTitle = m.title.length > 30 
                        ? m.title.substring(0, 29) + '...' 
                        : m.title;
                    
                    kalshiText += `**${shortTitle}**\n`;
                    kalshiText += `└ 🟢 $${yesPrice} • 📊 $${formatVolume(volume)} • ⏰ ${hoursLeft}h\n\n`;
                });
            } else {
                kalshiText = "No games in next 24h\n\n*Check back on game days*";
            }

            // Polymarket Column
            let polyText = "";
            if (polySports.length > 0) {
                polySports.forEach(p => {
                    let price = "-.--";
                    let hoursLeft = "?";
                    
                    if (p.markets?.[0]) {
                        if (p.markets[0].outcomePrices) {
                            try {
                                const parsed = JSON.parse(p.markets[0].outcomePrices);
                                price = parseFloat(parsed[0] || 0).toFixed(2);
                            } catch (e) { }
                        }
                        if (p.markets[0].endDate) {
                            const closeTime = new Date(p.markets[0].endDate);
                            hoursLeft = Math.max(0, Math.round((closeTime - now) / (1000 * 60 * 60)));
                        }
                    }
                    
                    const shortTitle = p.title.length > 30 
                        ? p.title.substring(0, 29) + '...' 
                        : p.title;
                    
                    polyText += `**${shortTitle}**\n`;
                    polyText += `└ 🟢 $${price} • 📊 $${formatVolume(p.volume)} • ⏰ ${hoursLeft}h\n\n`;
                });
            } else {
                polyText = "No games in next 24h\n\n*Check back on game days*";
            }

            embed.addFields(
                { name: '🇺🇸 Kalshi', value: kalshiText, inline: true },
                { name: '🌐 Polymarket', value: polyText, inline: true }
            );

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!sports] Error:', error);
            await message.reply("❌ Error fetching sports markets. Try again later.");
        }
        return;
    }

/* ========================================================================
       COMMAND: !debug (temporary - shows raw API data)
       ======================================================================== */
    if (lowerContent === '!debug') {
        try {
            await message.channel.sendTyping();

            // Fetch Kalshi
            const kalshiRes = await axios.get('https://api.elections.kalshi.com/trade-api/v2/markets?limit=100&status=open');
            const kalshiData = kalshiRes.data.markets || [];

            // Get unique categories
            const categories = [...new Set(kalshiData.map(m => m.category))];
            
            // Get sample titles from each category
            let debugText = `**Kalshi has ${kalshiData.length} open markets**\n\n`;
            debugText += `**Categories:** ${categories.join(', ')}\n\n`;
            
            // Show first 10 markets
            debugText += `**Sample markets:**\n`;
            kalshiData.slice(0, 10).forEach((m, i) => {
                const closeTime = new Date(m.close_time);
                const hoursLeft = Math.round((closeTime - new Date()) / (1000 * 60 * 60));
                debugText += `${i+1}. [${m.category}] ${m.title.substring(0, 50)}... (${hoursLeft}h)\n`;
            });

            // Check for anything sports-related
            const sportsKeywords = ['NFL', 'NBA', 'UFC', 'MLB', 'NHL', 'GAME', 'VS', 'SPORTS', 'FOOTBALL', 'BASKETBALL'];
            const sportish = kalshiData.filter(m => {
                const text = (m.title + ' ' + m.category).toUpperCase();
                return sportsKeywords.some(kw => text.includes(kw));
            });

            debugText += `\n**Sports-related markets found: ${sportish.length}**\n`;
            sportish.slice(0, 5).forEach(m => {
                debugText += `- ${m.title.substring(0, 60)}...\n`;
            });

            // Truncate if too long
            if (debugText.length > 1900) {
                debugText = debugText.substring(0, 1900) + '...';
            }

            await message.reply(debugText);

        } catch (error) {
            console.error('Debug error:', error);
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }
/* ========================================================================
       COMMAND: !odds [team or matchup]
       Get odds from multiple sportsbooks
       Example: !odds bucks vs wizards
       Example: !odds lakers
       ======================================================================== */
    if (lowerContent.startsWith('!odds ')) {
        const query = content.slice(6).trim().toUpperCase();
        
        if (!query) {
            await message.reply('🎰 Usage: `!odds [team or matchup]`\nExample: `!odds bucks vs wizards` or `!odds lakers`');
            return;
        }

        try {
            await message.channel.sendTyping();

            const ODDS_API_KEY = process.env.ODDS_API_KEY;
            
            if (!ODDS_API_KEY) {
                await message.reply('❌ Odds API key not configured. Add ODDS_API_KEY to environment variables.');
                return;
            }

            // Sports to check (can expand this list)
            const sports = [
                'basketball_nba',
                'football_nfl',
                'baseball_mlb',
                'hockey_nhl',
                'mma_mixed_martial_arts',
                'basketball_ncaab',
                'football_ncaaf'
            ];

            // Try each sport until we find matches
            let allGames = [];
            
            for (const sport of sports) {
                try {
                    const response = await axios.get(
                        `https://api.the-odds-api.com/v4/sports/${sport}/odds`, {
                            params: {
                                apiKey: ODDS_API_KEY,
                                regions: 'us',
                                markets: 'h2h,spreads,totals',
                                oddsFormat: 'american'
                            }
                        }
                    );
                    
                    if (response.data && response.data.length > 0) {
                        allGames = allGames.concat(response.data.map(g => ({ ...g, sport })));
                    }
                } catch (err) {
                    // Sport might not be in season, continue
                    console.log(`[!odds] ${sport}: ${err.message}`);
                }
            }

            console.log(`[!odds] Found ${allGames.length} total games`);

            // Search for the query in team names
            const searchTerms = query.replace(' VS ', ' ').replace(' V ', ' ').split(' ').filter(t => t.length > 2);
            
            const matchingGames = allGames.filter(game => {
                const homeTeam = game.home_team.toUpperCase();
                const awayTeam = game.away_team.toUpperCase();
                const matchup = `${homeTeam} ${awayTeam}`;
                
                return searchTerms.some(term => matchup.includes(term));
            });

            console.log(`[!odds] Matching games for "${query}": ${matchingGames.length}`);

            if (matchingGames.length === 0) {
                // Show available games
                const todayGames = allGames
                    .filter(g => {
                        const gameTime = new Date(g.commence_time);
                        const now = new Date();
                        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
                        return gameTime >= now && gameTime <= tomorrow;
                    })
                    .slice(0, 8);

                let availableText = "**Couldn't find that matchup.**\n\n";
                
                if (todayGames.length > 0) {
                    availableText += "**Games available today:**\n";
                    todayGames.forEach(g => {
                        const time = new Date(g.commence_time).toLocaleTimeString('en-US', { 
                            hour: 'numeric', 
                            minute: '2-digit' 
                        });
                        availableText += `• ${g.away_team} @ ${g.home_team} (${time})\n`;
                    });
                    availableText += "\n*Try: `!odds [team name]`*";
                } else {
                    availableText += "*No games found in the next 24 hours.*";
                }

                await message.reply(availableText);
                return;
            }

            // Use the first matching game
            const game = matchingGames[0];
            const gameTime = new Date(game.commence_time);
            const timeStr = gameTime.toLocaleString('en-US', {
                weekday: 'short',
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });

            // Build the embed
            const embed = new EmbedBuilder()
                .setColor(0xFF6B00)
                .setTitle(`🏀 ${game.away_team} @ ${game.home_team}`)
                .setDescription(`📅 ${timeStr}`)
                .setFooter({ text: 'Source: The Odds API • Lines may vary' });

            // Process bookmakers
            const bookmakers = game.bookmakers || [];
            
            if (bookmakers.length === 0) {
                embed.addFields({ name: '❌ No Odds Available', value: 'Lines not yet posted for this game.', inline: false });
            } else {
                // MONEYLINE (h2h)
                let moneylineText = "";
                bookmakers.forEach(book => {
                    const h2h = book.markets.find(m => m.key === 'h2h');
                    if (h2h) {
                        const away = h2h.outcomes.find(o => o.name === game.away_team);
                        const home = h2h.outcomes.find(o => o.name === game.home_team);
                        if (away && home) {
                            const awayOdds = away.price > 0 ? `+${away.price}` : away.price;
                            const homeOdds = home.price > 0 ? `+${home.price}` : home.price;
                            moneylineText += `**${book.title}:** ${game.away_team} ${awayOdds} | ${game.home_team} ${homeOdds}\n`;
                        }
                    }
                });
                
                if (moneylineText) {
                    embed.addFields({ name: '💰 Moneyline', value: moneylineText.substring(0, 1024), inline: false });
                }

                // SPREADS
                let spreadText = "";
                bookmakers.forEach(book => {
                    const spread = book.markets.find(m => m.key === 'spreads');
                    if (spread) {
                        const away = spread.outcomes.find(o => o.name === game.away_team);
                        const home = spread.outcomes.find(o => o.name === game.home_team);
                        if (away && home) {
                            const awaySpread = away.point > 0 ? `+${away.point}` : away.point;
                            const homeSpread = home.point > 0 ? `+${home.point}` : home.point;
                            spreadText += `**${book.title}:** ${game.away_team} ${awaySpread} | ${game.home_team} ${homeSpread}\n`;
                        }
                    }
                });
                
                if (spreadText) {
                    embed.addFields({ name: '📊 Spread', value: spreadText.substring(0, 1024), inline: false });
                }

                // TOTALS (Over/Under)
                let totalsText = "";
                bookmakers.forEach(book => {
                    const totals = book.markets.find(m => m.key === 'totals');
                    if (totals) {
                        const over = totals.outcomes.find(o => o.name === 'Over');
                        const under = totals.outcomes.find(o => o.name === 'Under');
                        if (over && under) {
                            totalsText += `**${book.title}:** O/U ${over.point} (O: ${over.price > 0 ? '+' + over.price : over.price} | U: ${under.price > 0 ? '+' + under.price : under.price})\n`;
                        }
                    }
                });
                
                if (totalsText) {
                    embed.addFields({ name: '🎯 Total (O/U)', value: totalsText.substring(0, 1024), inline: false });
                }
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!odds] Error:', error);
            await message.reply("❌ Error fetching odds. Try again later.");
        }
        return;
    }


    /* ========================================================================
       COMMAND: !games [sport]
       List today's games
       Example: !games nba
       ======================================================================== */
    if (lowerContent.startsWith('!games')) {
        const sportQuery = content.slice(6).trim().toUpperCase();
        
        try {
            await message.channel.sendTyping();

            const ODDS_API_KEY = process.env.ODDS_API_KEY;
            
            if (!ODDS_API_KEY) {
                await message.reply('❌ Odds API key not configured.');
                return;
            }

            // Map user input to API sport key
            const sportMap = {
                'NBA': 'basketball_nba',
                'BASKETBALL': 'basketball_nba',
                'NFL': 'football_nfl',
                'FOOTBALL': 'football_nfl',
                'MLB': 'baseball_mlb',
                'BASEBALL': 'baseball_mlb',
                'NHL': 'hockey_nhl',
                'HOCKEY': 'hockey_nhl',
                'UFC': 'mma_mixed_martial_arts',
                'MMA': 'mma_mixed_martial_arts',
                'NCAAB': 'basketball_ncaab',
                'CBB': 'basketball_ncaab',
                'NCAAF': 'football_ncaaf',
                'CFB': 'football_ncaaf'
            };

            const sportKey = sportMap[sportQuery] || 'basketball_nba'; // Default to NBA
            const sportName = sportQuery || 'NBA';

            const response = await axios.get(
                `https://api.the-odds-api.com/v4/sports/${sportKey}/odds`, {
                    params: {
                        apiKey: ODDS_API_KEY,
                        regions: 'us',
                        markets: 'h2h',
                        oddsFormat: 'american'
                    }
                }
            );

            const games = response.data || [];
            const now = new Date();
            const tomorrow = new Date(now.getTime() + 36 * 60 * 60 * 1000);

            // Filter to games in next 36 hours
            const upcomingGames = games
                .filter(g => {
                    const gameTime = new Date(g.commence_time);
                    return gameTime >= now && gameTime <= tomorrow;
                })
                .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor(0x5865F2)
                .setTitle(`🏀 ${sportName} Games Today`)
                .setFooter({ text: 'Use !odds [team] for full odds comparison' });

            if (upcomingGames.length > 0) {
                let gamesText = "";
                
                upcomingGames.forEach(g => {
                    const gameTime = new Date(g.commence_time);
                    const timeStr = gameTime.toLocaleTimeString('en-US', { 
                        hour: 'numeric', 
                        minute: '2-digit'
                    });
                    
                    // Get consensus odds if available
                    let oddsStr = "";
                    if (g.bookmakers?.[0]?.markets?.[0]?.outcomes) {
                        const outcomes = g.bookmakers[0].markets[0].outcomes;
                        const away = outcomes.find(o => o.name === g.away_team);
                        const home = outcomes.find(o => o.name === g.home_team);
                        if (away && home) {
                            const awayOdds = away.price > 0 ? `+${away.price}` : away.price;
                            const homeOdds = home.price > 0 ? `+${home.price}` : home.price;
                            oddsStr = ` (${awayOdds}/${homeOdds})`;
                        }
                    }
                    
                    gamesText += `**${timeStr}** - ${g.away_team} @ ${g.home_team}${oddsStr}\n`;
                });

                embed.setDescription(gamesText);
            } else {
                embed.setDescription(`No ${sportName} games scheduled in the next 36 hours.`);
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!games] Error:', error);
            await message.reply("❌ Error fetching games. Try again later.");
        }
        return;
    }
    
    /* ========================================================================
       COMMAND: !math [problem]
       ======================================================================== */
    if (lowerContent.startsWith('!math ')) {
        const problem = content.slice(6).trim();
        
        if (!problem) {
            await message.reply('🔢 Give me a problem! Example: `!math 25 * 4 + 10`');
            return;
        }

        try {
            await message.channel.sendTyping();

            const mathPrompt = `Solve this math problem step-by-step:
${problem}

Rules:
- Show clear, numbered steps
- Explain the reasoning briefly (assume basic math knowledge)
- Skip obvious steps, focus on the tricky parts
- Give the final answer clearly at the end
- Keep it concise`;

            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: [{ role: 'user', content: mathPrompt }],
            });

            const answer = response.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n\n');

            await sendResponseWithTyping(message, answer);

        } catch (error) {
            console.error('[!math] Error:', error);
            await message.reply("❌ Error solving that problem. Try again?");
        }
        return;
    }

/* ========================================================================
       COMMAND: !kaldebug - Debug Kalshi API
       ======================================================================== */
    if (lowerContent === '!kaldebug') {
        try {
            await message.channel.sendTyping();

            const response = await axios.get('https://api.elections.kalshi.com/trade-api/v2/markets?limit=200&status=open');
            const markets = response.data.markets || [];

            // Find all unique categories
            const categories = [...new Set(markets.map(m => m.category))];
            
            // Look for anything basketball/nba related
            const basketballKeywords = ['BASKETBALL', 'NBA', 'BUCKS', 'WIZARDS', 'LAKERS', 'CELTICS', 'HEAT', 'BULLS', 'SIXERS', '76ERS', 'KINGS', 'ROCKETS', 'HAWKS', 'PRO BASKETBALL'];
            
            const sportsMarkets = markets.filter(m => {
                const text = (m.title + ' ' + m.category + ' ' + m.ticker).toUpperCase();
                return basketballKeywords.some(kw => text.includes(kw));
            });

            let debugText = `**Kalshi API Response**\n\n`;
            debugText += `Total markets: ${markets.length}\n`;
            debugText += `Categories: ${categories.slice(0, 10).join(', ')}${categories.length > 10 ? '...' : ''}\n\n`;
            debugText += `**Sports/Basketball markets found: ${sportsMarkets.length}**\n\n`;

            if (sportsMarkets.length > 0) {
                sportsMarkets.slice(0, 8).forEach((m, i) => {
                    const closeTime = new Date(m.close_time);
                    const hoursLeft = Math.round((closeTime - new Date()) / (1000 * 60 * 60));
                    debugText += `${i + 1}. **${m.title.substring(0, 50)}**\n`;
                    debugText += `   Cat: ${m.category} | Ticker: ${m.ticker} | ${hoursLeft}h | Vol: ${m.volume}\n\n`;
                });
            } else {
                // Show sample of what IS available
                debugText += `*No basketball found. Sample markets:*\n`;
                markets.slice(0, 5).forEach((m, i) => {
                    debugText += `${i + 1}. [${m.category}] ${m.title.substring(0, 60)}\n`;
                });
            }

            // Truncate if needed
            if (debugText.length > 1900) {
                debugText = debugText.substring(0, 1900) + '...';
            }

            await message.reply(debugText);

        } catch (error) {
            console.error('Kaldebug error:', error);
            await message.reply(`❌ Error: ${error.message}`);
        }
        return;
    }
    /* ========================================================================
       COMMAND: !summary [text]
       ======================================================================== */
    if (lowerContent.startsWith('!summary ')) {
        const textToSummarize = content.slice(9).trim();
        
        if (!textToSummarize) {
            await message.reply('📝 Give me something to summarize! Example: `!summary [paste text here]`');
            return;
        }

        try {
            await message.channel.sendTyping();

            const summaryPrompt = `Summarize this text:
${textToSummarize}

Rules:
- Hit the key points, skip the filler
- Use bullet points if it helps clarity
- Don't dumb it down
- End with a TL;DR if it's longer content`;

            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: [{ role: 'user', content: summaryPrompt }],
            });

            const summary = response.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n\n');

            await sendResponseWithTyping(message, summary);

        } catch (error) {
            console.error('[!summary] Error:', error);
            await message.reply("❌ Error generating summary. Try again?");
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
        await sendResponseWithTyping(message, response);
        return;
    }


    /* ========================================================================
       MENTION HANDLER (@bot)
       ======================================================================== */
    if (message.mentions.has(client.user)) {
        const question = content.replace(/<@!?\d+>/g, '').trim();
        
        if (question) {
            const response = await chatWithClaude(message.channel.id, question);
            await sendResponseWithTyping(message, response);
        } else {
            await message.reply('👋 Hey! Ask me something.');
        }
        return;
    }
});


/* ============================================================================
   STARTUP
   ============================================================================ */

console.log('🚀 Initializing Bot...');
client.login(process.env.DISCORD_TOKEN);
