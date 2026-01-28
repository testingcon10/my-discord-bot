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

// Conversation state management
const conversationHistory = new Map();

// ==========================================
// HELPER FUNCTIONS
// ==========================================

/**
 * Retrieves the conversation history for a specific channel.
 * @param {string} channelId 
 * @returns {Array} Array of message objects
 */
function getConversationHistory(channelId) {
    if (!conversationHistory.has(channelId)) {
        conversationHistory.set(channelId, []);
    }
    return conversationHistory.get(channelId);
}

/**
 * Adds a message to the history buffer, maintaining the size limit.
 * @param {string} channelId 
 * @param {string} role - 'user' or 'assistant'
 * @param {string} content 
 */
function addToHistory(channelId, role, content) {
    const history = getConversationHistory(channelId);
    history.push({ role, content });

    if (history.length > HISTORY_LIMIT) {
        history.shift();
    }
}

/**
 * Clears conversation history for a channel.
 * @param {string} channelId 
 */
function clearHistory(channelId) {
    conversationHistory.set(channelId, []);
}

/**
 * Sends a typing indicator followed by the response (chunked if necessary).
 * @param {Message} message - Discord message object
 * @param {string} response - The text response to send
 */
async function sendResponseWithTyping(message, response) {
    await message.channel.sendTyping();

    if (response.length <= 2000) {
        await message.reply(response);
    } else {
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
 * Core Logic: Communicates with Anthropic Claude API.
 */
async function chatWithClaude(channelId, userMessage) {
    try {
        addToHistory(channelId, 'user', userMessage);
        const history = getConversationHistory(channelId);

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514', // Verify this model version is current
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

    // --------------------------------------------------
    // COMMAND: !sports (Live Feed)
    // --------------------------------------------------
    if (lowerContent === '!sports') {
        try {
            await message.channel.sendTyping();

            // Fetch high-volume markets, filtering out parlays
            const url = 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=500&status=open&mve_filter=exclude';
            const response = await axios.get(url);

            const sportsMarkets = response.data.markets
                .filter(m => {
                    const text = (m.title + m.category + m.ticker).toUpperCase();
                    // Strict keyword check
                    const isSport = text.includes('NFL') ||
                        text.includes('NBA') ||
                        text.includes('SUPER BOWL') ||
                        text.includes('UFC') ||
                        text.includes('CHAMPION') ||
                        (m.category && m.category.includes('Sports'));

                    // Filter out dead markets (volume < 100)
                    return isSport && m.volume > 100;
                })
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 5);

            if (sportsMarkets.length === 0) {
                await message.reply("📉 No active high-volume sports markets found.");
                return;
            }

            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🏆 Top Live Sports Markets')
                .setDescription('**Sorted by Volume** (Excluding Parlays)')
                .setFooter({ text: 'Data: Kalshi API • 0 Tokens Used' });

            for (const market of sportsMarkets) {
                const yesPrice = market.yes_bid ? (market.yes_bid / 100).toFixed(2) : "0.00";
                const noPrice = market.no_ask ? (market.no_ask / 100).toFixed(2) : "0.00";

                let volDisplay = `$${market.volume}`;
                if (market.volume > 1000000) volDisplay = `$${(market.volume / 1000000).toFixed(1)}M`;
                else if (market.volume > 1000) volDisplay = `$${(market.volume / 1000).toFixed(1)}k`;

                embed.addFields({
                    name: market.title,
                    value: `🟢 **Yes:** $${yesPrice} | 🔴 **No:** $${noPrice}\n-# 📊 Vol: ${volDisplay} • Ends: ${new Date(market.close_time).toLocaleDateString()}`
                });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Sports Feed Error:', error.message);
            await message.reply("❌ API Error. Please try again later.");
        }
        return;
    }

    // --------------------------------------------------
    // COMMAND: !clear
    // --------------------------------------------------
    if (lowerContent === '!clear') {
        clearHistory(message.channel.id);
        await message.reply('🧹 Memory cleared. Let\'s start fresh!');
        return;
    }

    // --------------------------------------------------
    // COMMAND: !math [problem]
    // --------------------------------------------------
    if (lowerContent.startsWith('!math ')) {
        const problem = content.slice(6).trim();
        if (problem) {
            const mathPrompt = `Solve this math problem step-by-step:\n${problem}\n\nRules:\n- Show clear, numbered steps\n- Explain briefly\n- Final answer at the end`;
            
            // Direct call to Anthropic (bypass main chat function for custom prompt)
            try {
                await message.channel.sendTyping();
                const response = await anthropic.messages.create({
                    model: 'claude-sonnet-4-20250514',
                    max_tokens: 1024,
                    messages: [{ role: 'user', content: mathPrompt }],
                });
                const answer = response.content[0].text;
                await sendResponseWithTyping(message, answer);
            } catch (e) {
                console.error(e);
                await message.reply("Error solving math problem.");
            }
        } else {
            await message.reply('🔢 Example: `!math 25 x 4 + 10`');
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