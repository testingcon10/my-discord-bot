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

            console.log(`[!sports] Fetched ${kalshiData.length} Kalshi markets, ${polyData.length} Polymarket events`);

            // DEBUG: Log sample Kalshi data to see structure
            console.log('[!sports] Sample Kalshi markets:', kalshiData.slice(0, 5).map(m => ({
                title: m.title,
                category: m.category,
                ticker: m.ticker,
                close_time: m.close_time,
                volume: m.volume
            })));

            // DEBUG: Log sample Polymarket data
            console.log('[!sports] Sample Polymarket events:', polyData.slice(0, 5).map(e => ({
                title: e.title,
                volume: e.volume,
                endDate: e.markets?.[0]?.endDate
            })));

            // ─────────────────────────────────────────────────────────────────
            // TIME FILTERS
            // ─────────────────────────────────────────────────────────────────
            
            const now = new Date();
            const in24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
            const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // Fallback

            // ─────────────────────────────────────────────────────────────────
            // KEYWORD DEFINITIONS
            // ─────────────────────────────────────────────────────────────────

            // Sports leagues/events to INCLUDE
            const sportsKeywords = [
                'NFL', 'NBA', 'UFC', 'MLB', 'NHL', 'NCAA', 'MLS', 'WNBA',
                'FOOTBALL', 'BASKETBALL', 'BASEBALL', 'HOCKEY', 'SOCCER',
                'MMA', 'BOXING', 'TENNIS', 'GOLF',
                'SUPER BOWL', 'MARCH MADNESS', 'WORLD SERIES', 'STANLEY CUP',
                'PREMIER LEAGUE', 'CHAMPIONS LEAGUE', 'LA LIGA', 'SERIE A',
                'LAKERS', 'CELTICS', 'WARRIORS', 'BULLS', 'HEAT', 'KNICKS',
                'CHIEFS', 'EAGLES', 'COWBOYS', 'PACKERS', '49ERS', 'RAVENS',
                'YANKEES', 'DODGERS', 'RED SOX', 'METS', 'CUBS',
                'GAME', 'VS', 'VERSUS'
            ];

            // Short-term bet types to PRIORITIZE
            const shortTermKeywords = [
                'GAME', 'MATCH', 'VS', 'V.S.', 'VERSUS',
                'POINTS', 'SCORE', 'SPREAD', 'OVER', 'UNDER',
                'TOUCHDOWN', 'TD', 'GOAL', 'ASSIST', 'REBOUND',
                'WINNER', 'WIN', 'BEAT', 'DEFEAT',
                'PROP', 'PLAYER', 'TEAM',
                'TONIGHT', 'TODAY', 'TOMORROW',
                'QUARTER', 'HALF', 'INNING', 'PERIOD', 'ROUND',
                'FIRST', 'ANYTIME'
            ];

            // Futures/long-term to EXCLUDE
            const futuresKeywords = [
                'CHAMPION 2025', 'CHAMPION 2026', 'CHAMPION 2027',
                'MVP 2025', 'MVP 2026', 'ROOKIE OF THE YEAR',
                'DEFENSIVE PLAYER OF THE YEAR',
                'SUPER BOWL CHAMPION', 'NBA CHAMPION', 'NFL CHAMPION',
                'WORLD SERIES CHAMPION', 'STANLEY CUP CHAMPION',
                'WIN THE 2025', 'WIN THE 2026', 'WIN 2025', 'WIN 2026',
                'AWARD', 'HALL OF FAME', 'RETIRE', 'DRAFT PICK'
            ];

            // Parlay patterns to EXCLUDE
            const parlayPatterns = [
                /\d\+\s*(YES|POINTS|GAMES)/i,   // "2+ YES", "3+ POINTS"
                /PARLAY/i,
                /COMBO/i
            ];

            // ─────────────────────────────────────────────────────────────────
            // PROCESS KALSHI DATA
            // ─────────────────────────────────────────────────────────────────

            // First, find ALL sports markets (ignore time for debugging)
            const allKalshiSports = kalshiData.filter(m => {
                if (!m.title) return false;
                const title = m.title.toUpperCase();
                const category = (m.category || '').toUpperCase();
                return sportsKeywords.some(kw => title.includes(kw) || category.includes(kw));
            });

            console.log(`[!sports] All Kalshi sports markets (any time): ${allKalshiSports.length}`);
            console.log('[!sports] Kalshi sports sample:', allKalshiSports.slice(0, 3).map(m => m.title));

            // Now filter for 24h
            const kalshiSports = allKalshiSports
                .filter(m => {
                    if (!m.close_time) return false;
                    
                    const title = m.title.toUpperCase();
                    const closeTime = new Date(m.close_time);
                    
                    // Must close within 24 hours (or 7 days as fallback if nothing in 24h)
                    const isWithin24h = closeTime <= in24Hours && closeTime > now;
                    
                    // Exclude futures
                    const isFutures = futuresKeywords.some(kw => title.includes(kw));
                    if (isFutures) return false;
                    
                    // Exclude parlays
                    const isParlay = parlayPatterns.some(pattern => pattern.test(m.title));
                    if (isParlay) return false;
                    
                    return isWithin24h;
                })
                .sort((a, b) => (b.volume_24h || b.volume || 0) - (a.volume_24h || a.volume || 0))
                .slice(0, 4);

            // If no 24h markets, try 7 days
            let kalshiFinal = kalshiSports;
            let kalshiTimeframe = "24h";
            
            if (kalshiSports.length === 0) {
                kalshiFinal = allKalshiSports
                    .filter(m => {
                        if (!m.close_time) return false;
                        const title = m.title.toUpperCase();
                        const closeTime = new Date(m.close_time);
                        const isFutures = futuresKeywords.some(kw => title.includes(kw));
                        const isParlay = parlayPatterns.some(pattern => pattern.test(m.title));
                        return closeTime <= in7Days && closeTime > now && !isFutures && !isParlay;
                    })
                    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
                    .slice(0, 4);
                kalshiTimeframe = "7d";
            }

            console.log(`[!sports] Kalshi final (${kalshiTimeframe}): ${kalshiFinal.map(m => m.title).join(', ') || 'None'}`);

            // ─────────────────────────────────────────────────────────────────
            // PROCESS POLYMARKET DATA
            // ─────────────────────────────────────────────────────────────────

            // First find all sports events
            const allPolySports = polyData.filter(e => {
                if (!e.title) return false;
                const title = e.title.toUpperCase();
                return sportsKeywords.some(kw => title.includes(kw)) && e.markets?.length > 0;
            });

            console.log(`[!sports] All Polymarket sports events: ${allPolySports.length}`);
            console.log('[!sports] Polymarket sports sample:', allPolySports.slice(0, 3).map(e => e.title));

            // Filter for short-term
            const polySports = allPolySports
                .filter(e => {
                    const title = e.title.toUpperCase();
                    
                    // Exclude futures
                    const isFutures = futuresKeywords.some(kw => title.includes(kw));
                    if (isFutures) return false;
                    
                    // Exclude parlays
                    const isParlay = parlayPatterns.some(pattern => pattern.test(e.title));
                    if (isParlay) return false;

                    // Check if closes within 24h
                    const hasShortTermMarket = e.markets.some(m => {
                        if (!m.endDate) return true; // Include if no end date
                        const closeTime = new Date(m.endDate);
                        return closeTime <= in24Hours && closeTime > now;
                    });
                    
                    return hasShortTermMarket;
                })
                .sort((a, b) => (b.volume || 0) - (a.volume || 0))
                .slice(0, 4);

            // Fallback to 7 days
            let polyFinal = polySports;
            let polyTimeframe = "24h";
            
            if (polySports.length === 0) {
                polyFinal = allPolySports
                    .filter(e => {
                        const title = e.title.toUpperCase();
                        const isFutures = futuresKeywords.some(kw => title.includes(kw));
                        const isParlay = parlayPatterns.some(pattern => pattern.test(e.title));
                        return !isFutures && !isParlay;
                    })
                    .sort((a, b) => (b.volume || 0) - (a.volume || 0))
                    .slice(0, 4);
                polyTimeframe = "7d";
            }

            console.log(`[!sports] Polymarket final (${polyTimeframe}): ${polyFinal.map(e => e.title).join(', ') || 'None'}`);

            // ─────────────────────────────────────────────────────────────────
            // BUILD DISCORD EMBED
            // ─────────────────────────────────────────────────────────────────

            const timeframeText = (kalshiTimeframe === "24h" && polyTimeframe === "24h") 
                ? "Next 24 Hours" 
                : "Upcoming Games";

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle(`🏈 Live Sports Markets (${timeframeText})`)
                .setDescription('Game outcomes, props & spreads • Sorted by volume • No futures')
                .setFooter({ text: `Updated: ${now.toLocaleTimeString()}` });

            // Kalshi Column
            let kalshiText = "";
            if (kalshiFinal.length > 0) {
                kalshiFinal.forEach(m => {
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
                kalshiText = "No markets found\n\n*Kalshi may have limited sports*";
            }

            // Polymarket Column
            let polyText = "";
            if (polyFinal.length > 0) {
                polyFinal.forEach(p => {
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
                polyText = "No markets found\n\n*Check back during game days*";
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
