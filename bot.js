// ===================================
// MY AWESOME CLAUDE DISCORD BOT
// ===================================

// These lines load all the tools we need
const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();
const axios = require('axios');

// Create the Discord bot
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});

// Create the Claude AI connection
const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

// This stores conversation history so Claude remembers what you talked about!
const conversationHistory = new Map();

// ===================================
// QUALITY OF LIFE FEATURE #1: 
// Conversation Memory
// ===================================
function getConversationHistory(channelId) {
    if (!conversationHistory.has(channelId)) {
        conversationHistory.set(channelId, []);
    }
    return conversationHistory.get(channelId);
}

function addToHistory(channelId, role, content) {
    const history = getConversationHistory(channelId);
    history.push({ role, content });

    // Only remember the last 20 messages (so it doesn't get too long)
    if (history.length > 20) {
        history.shift(); // Remove the oldest message
    }
}

// ===================================
// QUALITY OF LIFE FEATURE #2:
// Clear Memory Command
// ===================================
function clearHistory(channelId) {
    conversationHistory.set(channelId, []);
}

// ===================================
// QUALITY OF LIFE FEATURE #3:
// System Prompt (Bot's Personality!)
// ===================================
const SYSTEM_PROMPT = `You are a smart, witty AI assistant in a Discord server.
You're talking to people in their 20s, so:
- Be casual and conversational, like a knowledgeable friend
- Don't over-explain or be condescending
- Try to avoid light humor and sarcasm
- Be direct and get to the point
- Use emojis sparingly, only when it adds to the vibe
- Keep responses concise but informative
- It's fine to say "I don't know" or suggest they Google something obscure`;

// ===================================
// THE MAIN CHAT FUNCTION
// ===================================
async function chatWithClaude(channelId, userMessage) {
    try {
        // Add the user's message to history
        addToHistory(channelId, 'user', userMessage);

        // Get the full conversation history
        const history = getConversationHistory(channelId);

        // Send the message to Claude and get a response
        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-20250514', // This is the Claude model we're using
            max_tokens: 1024,
            system: SYSTEM_PROMPT,
            messages: history,
            // This gives Claude the ability to search the web!
            tools: [
                {
                    type: "web_search_20250305",
                    name: "web_search"
                }
            ]
        });

        // Get Claude's response text (handles web search responses too)
        const assistantMessage = response.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n\n');

        // Save Claude's response to history
        addToHistory(channelId, 'assistant', assistantMessage);

        return assistantMessage;

    } catch (error) {
        console.error('Oops! Something went wrong:', error);
        return "Sorry, I had a little trouble thinking! Can you try asking again? 🤔";
    }
}

// ===================================
// QUALITY OF LIFE FEATURE #4:
// Typing Indicator (shows "bot is typing...")
// ===================================
async function sendResponseWithTyping(message, response) {
    // Show that the bot is typing
    await message.channel.sendTyping();

    // Discord has a 2000 character limit, so we might need to split long messages
    if (response.length <= 2000) {
        await message.reply(response);
    } else {
        // Split into chunks for long messages
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

// ===================================
// WHEN THE BOT TURNS ON
// ===================================
client.once('ready', () => {
    console.log('='.repeat(50));
    console.log(`🎉 SUCCESS! Your bot is now online!`);
    console.log(`🤖 Bot name: ${client.user.tag}`);
    console.log(`💬 The bot will respond when you mention it or use !ask`);
    console.log('='.repeat(50));
});

// ===================================
// WHEN SOMEONE SENDS A MESSAGE
// ===================================
client.on('messageCreate', async (message) => {
    // Ignore messages from bots (including itself!)
    if (message.author.bot) return;

    // Get the message content
    const content = message.content.trim();
    // ===================================
    // KALSHI MARKET FEED COMMAND
    // ===================================
    if (content.toLowerCase().startsWith('!kalshi ')) {
        const ticker = content.slice(8).trim().toUpperCase();

        if (!ticker) {
            await message.reply("📊 Give me a ticker! Example: `!kalshi KXHIGHNY`");
            return;
        }

        try {
            await message.channel.sendTyping();

            // Fetch data from Kalshi's public API
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
            console.error('Kalshi Error:', error.message);
            await message.reply("❌ Couldn't find that market. Check the ticker and try again.\nExample: `!kalshi KXHIGHNY`");
        }
        return;
    }
    // ===================================
    // NEW: LIVE SPORTS FEED (Token Optimized)
    // ===================================
    if (content.toLowerCase() === '!sports') {
        try {
            // OPTIMIZATION: We do NOT call 'anthropic' here.
            // This runs purely on your CPU + Kalshi API (Free & Fast)
            await message.channel.sendTyping();

            // 1. Fetch 100 active markets
            const url = 'https://api.elections.kalshi.com/trade-api/v2/markets?limit=100&status=open';
            const response = await axios.get(url);

            // 2. Filter for Sports & Sort by Volume
            // We do the "thinking" here in JS, saving AI tokens
            const sportsMarkets = response.data.markets
                .filter(m => m.category === 'Sports' || m.ticker.startsWith('NBA') || m.ticker.startsWith('NFL'))
                .sort((a, b) => b.volume - a.volume)
                .slice(0, 5);

            if (sportsMarkets.length === 0) {
                await message.reply("📉 No active high-volume sports markets found.");
                return;
            }

            // 3. Create the Embed (Mobile Friendly)
            const embed = new EmbedBuilder()
                .setColor(0x00FF00)
                .setTitle('🏆 Top Live Sports Markets')
                .setDescription('Sorted by highest trading volume')
                .setFooter({ text: 'Data: Kalshi API • 0 Tokens Used' });

            for (const market of sportsMarkets) {
                const yesPrice = (market.yes_bid / 100).toFixed(2);
                const noPrice = (market.no_ask / 100).toFixed(2);
                // Simple volume formatter (e.g. 15000 -> 15k)
                const vol = (market.volume > 1000)
                    ? (market.volume / 1000).toFixed(1) + 'k'
                    : market.volume;

                embed.addFields({
                    name: market.title,
                    value: `🟢 **Yes:** $${yesPrice} | 🔴 **No:** $${noPrice}\n-# 📊 Vol: ${vol} • Ends: ${new Date(market.close_time).toLocaleDateString()}`
                });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('Sports Feed Error:', error.message);
            await message.reply("❌ API Error. Try again in a minute.");
        }
        return; // Stop here so we don't accidentally trigger the AI
    }
    // ===================================
    // KALSHI SEARCH COMMAND (uses Claude)
    // ===================================
    if (content.toLowerCase().startsWith('!markets ')) {
        const query = content.slice(9).trim();

        if (!query) {
            await message.reply("🔍 What markets are you looking for? Example: `!markets election odds`");
            return;
        }

        try {
            await message.channel.sendTyping();

            const response = await anthropic.messages.create({
                model: 'claude-sonnet-4-20250514',
                max_tokens: 1024,
                messages: [{
                    role: 'user',
                    content: `Search for current Kalshi prediction markets related to: ${query}
          
Give me 3-5 relevant markets with their tickers if possible. Include current prices/odds if available. Keep it brief and scannable.`
                }],
                tools: [
                    {
                        type: "web_search_20250305",
                        name: "web_search"
                    }
                ]
            });

            const answer = response.content
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('\n\n');

            await sendResponseWithTyping(message, answer);
        } catch (error) {
            console.error('Markets search error:', error.message);
            await message.reply("❌ Couldn't search markets right now. Try again later.");
        }
        return;
    }

    // =================================== 
    // (your other commands like !clear, !help, etc. continue below)
    // ===================================
    // QUALITY OF LIFE FEATURE #5:
    // Special Commands
    // ===================================

    // Command: !clear - Forget the conversation
    if (content.toLowerCase() === '!clear') {
        clearHistory(message.channel.id);
        await message.reply('🧹 Memory cleared! I forgot our conversation. Let\'s start fresh!');
        return;
    }
    // ===================================
    // MATH SOLVER COMMAND
    // ===================================
    if (content.toLowerCase().startsWith('!math ')) {
        const problem = content.slice(6).trim();
        if (problem) {
            const mathPrompt = `Solve this math problem step-by-step:
${problem}

Rules:
- Show clear, numbered steps
- Explain the reasoning briefly (assume the person knows basic math)
- Skip obvious steps, focus on the tricky parts
- Give the final answer clearly at the end
- Keep it concise, no fluff`;

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
        } else {
            await message.reply('🔢 Give me a math problem! Example: `!math 25 x 4 + 10`');
        }
        return;
    }

    // ===================================
    // SUMMARY BOT COMMAND
    // ===================================
    if (content.toLowerCase().startsWith('!summary ')) {
        const textToSummarize = content.slice(9).trim();
        if (textToSummarize) {
            const summaryPrompt = `Summarize this text:
${textToSummarize}

Rules:
- Hit the key points, skip the filler
- Use bullet points if it makes sense, otherwise just a short paragraph
- Don't dumb it down
- End with a TL;DR if it's a longer piece`;

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
        } else {
            await message.reply('📝 Give me something to summarize! Example: `!summary [paste a long paragraph here]`');
        }
        return;
    }
    // Command: !help - Show what the bot can do
    if (content.toLowerCase() === '!help') {
        const helpMessage = `
**🤖 Hi! I'm your Claude AI assistant! Here's how to use me:**

**Talk to me by:**
- Mentioning me: @${client.user.username} your question here
- Using the command: \`!ask your question here\`

**Special commands:**
- \`!help\` - Shows this help message
- \`!ask\` - Ask the bot a question
- \`!math\` - Solve a math problem step-by-step 🔢
- \`!summary\` - Summarize long text 📝
- \`!kalshi [ticker]\` - Get live Kalshi market prices 📊
- \`!markets [topic]\` - Search for Kalshi markets 🔍
- \`!clear\` - Fresh start, clear memory

**Tips:**
- I remember our conversation, so you can ask follow-up questions!
- I try to keep my answers short and helpful
- Ask me anything - homework help, creative writing, coding questions, and more!
    `;
        await message.reply(helpMessage);
        return;
    }

    // Command: !ask - Ask Claude something
    if (content.toLowerCase().startsWith('!ask ')) {
        const question = content.slice(5).trim(); // Remove "!ask " from the start
        if (question) {
            const response = await chatWithClaude(message.channel.id, question);
            await sendResponseWithTyping(message, response);
        } else {
            await message.reply('❓ You need to ask something! Try: `!ask What is the capital of France?`');
        }
        return;
    }

    // If someone @mentions the bot, respond to them
    if (message.mentions.has(client.user)) {
        // Remove the @mention from the message to get just the question
        const question = content.replace(/<@!?\d+>/g, '').trim();
        if (question) {
            const response = await chatWithClaude(message.channel.id, question);
            await sendResponseWithTyping(message, response);
        } else {
            await message.reply('👋 Hi! Did you want to ask me something? Try mentioning me with a question!');
        }
        return;
    }
});

// ===================================
// TURN ON THE BOT!
// ===================================
console.log('🚀 Starting your Claude Discord Bot...');
client.login(process.env.DISCORD_TOKEN);