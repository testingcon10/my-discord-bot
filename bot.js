/**
 * Discord Bot Application
 * Integrates Claude AI and Kalshi Market API
 */

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
require('dotenv').config();

// ==========================================
// CONFIGURATION & CONSTANTS
// ==========================================

const SYSTEM_PROMPT = `You are a smart, witty AI assistant in a Discord server.
You're talking to people in their 20s, so:
- Be casual and conversational, like a knowledgeable friend
- Don't over-explain or be condescending
- Try to avoid light humor and sarcasm
- Be direct and get to the point
- Use emojis sparingly, only when it adds to the vibe
- Keep responses concise but informative
- It's fine to say "I don't know" or suggest they Google something obscure`;

const HISTORY_LIMIT = 20;

// ==========================================
// INITIALIZATION
// ==========================================

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

// ==========================================
// HELPER FUNCTIONS
// ==========================================

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

async function sendResponseWithTyping(message, response) {
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
        return "Sorry, I had a little trouble thinking! Can you try asking again? 🤔";
    }
}

// ==========================================
// EVENT LISTENERS
// ==========================================

client.once('ready', () => {
    console.log('--------------------------------------------------');
    console.log(`✅ Bot Online: ${client.user.tag}`);
    console.log(`📅 Started at: ${new Date().toLocaleString()}`);
    console.log('--------------------------------------------------');
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const content = message.content.trim();
    const lowerContent = content.toLowerCase();

    // --------------------------------------------------
    // COMMAND: !kalshi [ticker]
    // --------------------------------------------------
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

            const priceMessage = `
**📊 Kalshi Market: ${market.title}**
- **Ticker:** ${market.ticker}
- **Yes Price:** $${(market.yes_bid / 100).toFixed(2)}
- **No Price:** $${(market.no_ask / 100).toFixed(2)}
- **Status:** ${market.status}
- **Closes:** ${new Date(market.close_time).toLocaleString()}
            `;
            await message.reply(priceMessage);
        } catch (error) {
            console.error('Kalshi API Error:', error.message);
            await message.reply("❌ Couldn't find that market. Please check the ticker.");
        }
        return;
    }

 // ===================================
    // COMMAND: !sports
    // ===================================
    if (lowerContent === '!sports') {
        try {
            await message.channel.sendTyping();

            // 1. Fetch from both APIs
            const fetchKalshi = axios.get('https://api.elections.kalshi.com/trade-api/v2/markets?limit=500&status=open')
                .then(res => res.data.markets || [])
                .catch(err => { console.error("Kalshi Failed:", err.message); return []; });

            const fetchPoly = axios.get('https://gamma-api.polymarket.com/events?limit=50&active=true&closed=false')
                .then(res => Array.isArray(res.data) ? res.data : [])
                .catch(err => { console.error("Polymarket Failed:", err.message); return []; });

            const [kalshiData, polyData] = await Promise.all([fetchKalshi, fetchPoly]);

            console.log(`Fetched ${kalshiData.length} Kalshi markets, ${polyData.length} Polymarket events`);

            const formatVol = (num) => {
                if (!num) return "0";
                if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
                if (num >= 1000) return (num / 1000).toFixed(1) + 'k';
                return num.toString();
            };

            // 2. Process Kalshi - broader sports keywords
            const sportsKeywords = ['NFL', 'NBA', 'UFC', 'SUPER BOWL', 'FOOTBALL', 'BASKETBALL', 'SOCCER', 'MLB', 'HOCKEY', 'NHL', 'TENNIS', 'GOLF', 'BOXING', 'MMA', 'SPORTS', 'GAME', 'MATCH', 'CHAMPIONSHIP', 'SERIES', 'PLAYOFF'];
            
            const kalshiSports = kalshiData
                .filter(m => {
                    if (!m.title) return false;
                    const searchText = (m.title + ' ' + (m.category || '') + ' ' + (m.ticker || '')).toUpperCase();
                    return sportsKeywords.some(keyword => searchText.includes(keyword));
                })
                .sort((a, b) => (b.volume || 0) - (a.volume || 0))
                .slice(0, 3);

            console.log(`Found ${kalshiSports.length} Kalshi sports markets`);

            // 3. Process Polymarket - broader sports keywords
            const polySports = polyData
                .filter(e => {
                    if (!e.title) return false;
                    const searchText = e.title.toUpperCase();
                    const hasMarkets = e.markets && e.markets.length > 0;
                    return hasMarkets && sportsKeywords.some(keyword => searchText.includes(keyword));
                })
                .sort((a, b) => (b.volume || 0) - (a.volume || 0))
                .slice(0, 3);

            console.log(`Found ${polySports.length} Polymarket sports events`);

            // 4. Build Embed
            const embed = new EmbedBuilder()
                .setColor(0xFF4500)
                .setTitle('⚡ Live Sports Markets')
                .setFooter({ text: 'Sources: Kalshi & Polymarket • Live' });

            // Kalshi Column
            let kalshiText = "";
            if (kalshiSports.length > 0) {
                kalshiSports.forEach(m => {
                    const yes = m.yes_bid ? (m.yes_bid / 100).toFixed(2) : "-.--";
                    const shortTitle = m.title.length > 30 ? m.title.substring(0, 29) + '...' : m.title;
                    kalshiText += `**${shortTitle}**\n└ 🟢 $${yes} • 📊 $${formatVol(m.volume)}\n\n`;
                });
            } else {
                kalshiText = "No sports markets found right now";
            }

            // Polymarket Column
            let polyText = "";
            if (polySports.length > 0) {
                polySports.forEach(p => {
                    let price = "-.--";
                    if (p.markets?.[0]?.outcomePrices) {
                        try {
                            const parsed = JSON.parse(p.markets[0].outcomePrices);
                            price = parseFloat(parsed[0] || 0).toFixed(2);
                        } catch (e) { console.log("Poly Parse Error", e); }
                    }
                    const shortTitle = p.title.length > 30 ? p.title.substring(0, 29) + '...' : p.title;
                    polyText += `**${shortTitle}**\n└ 🟢 $${price} • 📊 $${formatVol(p.volume)}\n\n`;
                });
            } else {
                polyText = "No sports markets found right now";
            }

            embed.addFields(
                { name: '🇺🇸 Kalshi', value: kalshiText, inline: true },
                { name: '🌐 Polymarket', value: polyText, inline: true }
            );

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Sports Feed Error:', error);
            await message.reply("❌ Error fetching sports markets. Try again later.");
        }
        return;
    }

    // --------------------------------------------------
    // COMMAND: !summary [text]
    // --------------------------------------------------
    if (lowerContent.startsWith('!summary ')) {
        const textToSummarize = content.slice(9).trim();
        if (textToSummarize) {
            const summaryPrompt = `Summarize this text:\n${textToSummarize}\n\nRules:\n- Bullet points preferred\n- Include TL;DR if long`;
            try {
                await message.channel.sendTyping();
                const response = await anthropic.messages.create({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 1024,
                    messages: [{ role: 'user', content: summaryPrompt }],
                });
                const summary = response.content[0].text;
                await sendResponseWithTyping(message, summary);
            } catch (e) {
                console.error(e);
                await message.reply("Error generating summary.");
            }
        } else {
            await message.reply('📝 Example: `!summary [paste text]`');
        }
        return;
    }

    // --------------------------------------------------
    // COMMAND: !help
    // --------------------------------------------------
    if (lowerContent === '!help') {
        const helpMessage = `
**🤖 Claude Assistant Help**

**Interaction:**
- Mention me: @${client.user.username} [question]
- Command: \`!ask [question]\`

**Features:**
- \`!sports\` - Top live sports markets (High Vol) 🏆
- \`!kalshi [ticker]\` - Live market prices 📊
- \`!math\` - Step-by-step solver 🔢
- \`!summary\` - Text summarizer 📝
- \`!clear\` - Clear conversation memory 🧹
- \`!help\` - Show this menu
    `;
        await message.reply(helpMessage);
        return;
    }

    // --------------------------------------------------
    // COMMAND: !ask [question]
    // --------------------------------------------------
    if (lowerContent.startsWith('!ask ')) {
        const question = content.slice(5).trim();
        if (question) {
            const response = await chatWithClaude(message.channel.id, question);
            await sendResponseWithTyping(message, response);
        } else {
            await message.reply('❓ Example: `!ask What is the capital of France?`');
        }
        return;
    }

    // --------------------------------------------------
    // MENTION HANDLER
    // --------------------------------------------------
    if (message.mentions.has(client.user)) {
        const question = content.replace(/<@!?\d+>/g, '').trim();
        if (question) {
            const response = await chatWithClaude(message.channel.id, question);
            await sendResponseWithTyping(message, response);
        } else {
            await message.reply('👋 Hi! Mention me with a question to chat.');
        }
        return;
    }
});

// ==========================================
// STARTUP
// ==========================================
console.log('🚀 Initializing Bot...');
client.login(process.env.DISCORD_TOKEN);