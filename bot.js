// ===================================
// MY AWESOME CLAUDE DISCORD BOT
// ===================================

// These lines load all the tools we need
const { Client, GatewayIntentBits, Partials } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

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
const SYSTEM_PROMPT = `You are a friendly, helpful AI assistant in a Discord server. 
You're talking to people who might be young, so:
- Keep your answers clear and easy to understand
- Be encouraging and positive
- If someone asks something inappropriate, politely redirect them
- Use emojis sometimes to be friendly! 😊
- Keep responses reasonably short (under 1500 characters when possible)
- If you don't know something, it's okay to say so!`;

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
    // QUALITY OF LIFE FEATURE #5:
    // Special Commands
    // ===================================

    // Command: !clear - Forget the conversation
    if (content.toLowerCase() === '!clear') {
        clearHistory(message.channel.id);
        await message.reply('🧹 Memory cleared! I forgot our conversation. Let\'s start fresh!');
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
- \`!clear\` - Makes me forget our conversation (fresh start!)

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