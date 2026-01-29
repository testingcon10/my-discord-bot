/**
 * ============================================================================
 * DISCORD BOT - SPORTS BETTING & AI ASSISTANT
 * ============================================================================
 * 
 * Commands:
 *   !odds [team]       - Compare odds across sportsbooks (The Odds API)
 *   !games [sport]     - List today's games with odds
 *   !kalshi [search]   - Search Kalshi prediction markets
 *   !ask [question]    - Ask Claude AI (with web search)
 *   !math [problem]    - Step-by-step math solver
 *   !summary [text]    - Summarize long text
 *   !clear             - Clear conversation memory
 *   !help              - Show all commands
 * 
 * Required Environment Variables:
 *   DISCORD_TOKEN      - Discord bot token
 *   ANTHROPIC_API_KEY  - Claude API key
 *   ODDS_API_KEY       - The Odds API key (free at https://the-odds-api.com)
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
   BOT READY
   ============================================================================ */

client.once('ready', () => {
    console.log('═══════════════════════════════════════════════════════');
    console.log(`  ✅ BOT ONLINE: ${client.user.tag}`);
    console.log(`  📅 ${new Date().toLocaleString()}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('  Commands: !odds, !games, !kalshi, !ask, !math, !summary, !help');
    console.log('═══════════════════════════════════════════════════════');
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
            .setFooter({ text: 'Odds from The Odds API • AI by Claude' });

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
       Compare odds across multiple sportsbooks
       ======================================================================== */
    if (lowerContent.startsWith('!odds')) {
        const query = content.slice(5).trim().toUpperCase();
        
        if (!query) {
            await message.reply('🎰 **Usage:** `!odds [team]`\n**Examples:**\n• `!odds bucks`\n• `!odds lakers vs celtics`\n• `!odds chiefs`');
            return;
        }

        try {
            await message.channel.sendTyping();

            const ODDS_API_KEY = process.env.ODDS_API_KEY;
            
            if (!ODDS_API_KEY) {
                await message.reply('❌ ODDS_API_KEY not configured. Get a free key at https://the-odds-api.com');
                return;
            }

            // Sports to search
            const sports = [
                'basketball_nba',
                'football_nfl', 
                'baseball_mlb',
                'hockey_nhl',
                'basketball_ncaab',
                'football_ncaaf',
                'mma_mixed_martial_arts'
            ];

            let allGames = [];

            // Fetch odds from each sport
            for (const sport of sports) {
                try {
                    const res = await axios.get(`https://api.the-odds-api.com/v4/sports/${sport}/odds`, {
                        params: {
                            apiKey: ODDS_API_KEY,
                            regions: 'us',
                            markets: 'h2h,spreads,totals',
                            oddsFormat: 'american'
                        },
                        timeout: 5000
                    });
                    if (res.data?.length) {
                        allGames = allGames.concat(res.data);
                    }
                } catch (e) {
                    // Sport may not be in season
                }
            }

            console.log(`[!odds] Fetched ${allGames.length} games across all sports`);

            if (allGames.length === 0) {
                await message.reply('❌ Could not fetch odds. Try again later.');
                return;
            }

            // Search for matching games
            const searchTerms = query.replace(/\s+VS\s+|\s+V\s+|\s+@\s+/g, ' ').split(' ').filter(t => t.length > 2);
            
            const matches = allGames.filter(game => {
                const matchup = `${game.home_team} ${game.away_team}`.toUpperCase();
                return searchTerms.some(term => matchup.includes(term));
            });

            if (matches.length === 0) {
                // Show available games
                const now = new Date();
                const upcoming = allGames
                    .filter(g => new Date(g.commence_time) > now)
                    .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
                    .slice(0, 8);

                let text = `❌ **No games found for "${query}"**\n\n`;
                if (upcoming.length > 0) {
                    text += '**Upcoming games:**\n';
                    upcoming.forEach(g => {
                        const time = new Date(g.commence_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                        text += `• ${g.away_team} @ ${g.home_team} (${time})\n`;
                    });
                }
                await message.reply(text);
                return;
            }

            // Use first match
            const game = matches[0];
            const gameTime = new Date(game.commence_time).toLocaleString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });

            const embed = new EmbedBuilder()
                .setColor(0xFF6B00)
                .setTitle(`🏀 ${game.away_team} @ ${game.home_team}`)
                .setDescription(`📅 ${gameTime}`)
                .setFooter({ text: 'Source: The Odds API' });

            const books = game.bookmakers || [];

            if (books.length === 0) {
                embed.addFields({ name: 'No Odds', value: 'Lines not yet available', inline: false });
            } else {
                // MONEYLINE
                let mlText = "";
                books.slice(0, 6).forEach(book => {
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
                if (mlText) embed.addFields({ name: '💰 Moneyline (Away/Home)', value: mlText, inline: false });

                // SPREAD
                let spText = "";
                books.slice(0, 6).forEach(book => {
                    const spread = book.markets.find(m => m.key === 'spreads');
                    if (spread) {
                        const away = spread.outcomes.find(o => o.name === game.away_team);
                        const home = spread.outcomes.find(o => o.name === game.home_team);
                        if (away && home) {
                            const aSpread = away.point > 0 ? `+${away.point}` : away.point;
                            const hSpread = home.point > 0 ? `+${home.point}` : home.point;
                            spText += `**${book.title}:** ${game.away_team} ${aSpread} | ${game.home_team} ${hSpread}\n`;
                        }
                    }
                });
                if (spText) embed.addFields({ name: '📊 Spread', value: spText, inline: false });

                // TOTALS
                let totText = "";
                books.slice(0, 6).forEach(book => {
                    const totals = book.markets.find(m => m.key === 'totals');
                    if (totals) {
                        const over = totals.outcomes.find(o => o.name === 'Over');
                        if (over) {
                            totText += `**${book.title}:** O/U ${over.point}\n`;
                        }
                    }
                });
                if (totText) embed.addFields({ name: '🎯 Total (O/U)', value: totText, inline: false });
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!odds] Error:', error.message);
            await message.reply('❌ Error fetching odds. Try again later.');
        }
        return;
    }


    /* ========================================================================
       COMMAND: !games [sport]
       List today's games with basic odds
       ======================================================================== */
    if (lowerContent.startsWith('!games')) {
        const sportQuery = content.slice(6).trim().toUpperCase() || 'NBA';
        
        try {
            await message.channel.sendTyping();

            const ODDS_API_KEY = process.env.ODDS_API_KEY;
            if (!ODDS_API_KEY) {
                await message.reply('❌ ODDS_API_KEY not configured.');
                return;
            }

            const sportMap = {
                'NBA': 'basketball_nba',
                'NFL': 'football_nfl',
                'MLB': 'baseball_mlb',
                'NHL': 'hockey_nhl',
                'NCAAB': 'basketball_ncaab',
                'CBB': 'basketball_ncaab',
                'NCAAF': 'football_ncaaf',
                'CFB': 'football_ncaaf',
                'UFC': 'mma_mixed_martial_arts',
                'MMA': 'mma_mixed_martial_arts'
            };

            const sportKey = sportMap[sportQuery] || 'basketball_nba';

            const res = await axios.get(`https://api.the-odds-api.com/v4/sports/${sportKey}/odds`, {
                params: {
                    apiKey: ODDS_API_KEY,
                    regions: 'us',
                    markets: 'h2h',
                    oddsFormat: 'american'
                },
                timeout: 5000
            });

            const games = res.data || [];
            const now = new Date();
            const cutoff = new Date(now.getTime() + 36 * 60 * 60 * 1000);

            const upcoming = games
                .filter(g => {
                    const t = new Date(g.commence_time);
                    return t >= now && t <= cutoff;
                })
                .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
                .slice(0, 10);

            const embed = new EmbedBuilder()
                .setColor(0x00AA00)
                .setTitle(`🏀 ${sportQuery} Games Today`)
                .setFooter({ text: 'Use !odds [team] for full comparison' });

            if (upcoming.length > 0) {
                let text = "";
                upcoming.forEach(g => {
                    const time = new Date(g.commence_time).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                    
                    let odds = "";
                    if (g.bookmakers?.[0]?.markets?.[0]?.outcomes) {
                        const outcomes = g.bookmakers[0].markets[0].outcomes;
                        const away = outcomes.find(o => o.name === g.away_team);
                        const home = outcomes.find(o => o.name === g.home_team);
                        if (away && home) {
                            const a = away.price > 0 ? `+${away.price}` : away.price;
                            const h = home.price > 0 ? `+${home.price}` : home.price;
                            odds = ` (${a}/${h})`;
                        }
                    }
                    
                    text += `**${time}** • ${g.away_team} @ ${g.home_team}${odds}\n`;
                });
                embed.setDescription(text);
            } else {
                embed.setDescription(`No ${sportQuery} games in the next 36 hours.`);
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!games] Error:', error.message);
            await message.reply('❌ Error fetching games. Try again later.');
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

            // Filter out multi-game parlays (contain "MULTIGAME" in ticker or multiple teams in title)
            const singleGameMarkets = markets.filter(m => {
                const ticker = (m.ticker || '').toUpperCase();
                const title = (m.title || '').toUpperCase();
                
                // Exclude multi-game parlays
                if (ticker.includes('MULTIGAME')) return false;
                if (ticker.includes('EXTENDED')) return false;
                
                // Exclude titles with multiple "yes" (parlays)
                const yesCount = (title.match(/YES/g) || []).length;
                if (yesCount > 1) return false;
                
                // Exclude titles with commas between teams (parlays)
                if (/YES.*,.*YES/i.test(title)) return false;
                
                return true;
            });

            console.log(`[!kalshi] After filtering parlays: ${singleGameMarkets.length}`);

            let filtered = singleGameMarkets;

            // If query provided, search for it
            if (query) {
                const terms = query.split(' ').filter(t => t.length > 1);
                filtered = singleGameMarkets.filter(m => {
                    const text = `${m.title} ${m.category} ${m.ticker}`.toUpperCase();
                    return terms.some(term => text.includes(term));
                });
            }

            // Sort by close time (soonest first) then by volume
            const now = new Date();
            filtered = filtered
                .filter(m => m.close_time && new Date(m.close_time) > now)
                .sort((a, b) => {
                    // Prioritize by volume first
                    const volDiff = (b.volume || 0) - (a.volume || 0);
                    if (volDiff !== 0) return volDiff;
                    // Then by close time
                    return new Date(a.close_time) - new Date(b.close_time);
                })
                .slice(0, 8);

            const embed = new EmbedBuilder()
                .setColor(0x6B5BFF)
                .setTitle(query ? `🔮 Kalshi: "${query}"` : '🔮 Kalshi Top Markets')
                .setFooter({ text: 'Source: Kalshi • Yes/No prices shown' });

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
                let suggestions = 'Try searching for:\n• `!kalshi nba`\n• `!kalshi trump`\n• `!kalshi inflation`\n• `!kalshi weather`';
                embed.setDescription(query 
                    ? `No markets found for "${query}"\n\n${suggestions}`
                    : `No markets found.\n\n${suggestions}`);
            }

            await message.reply({ embeds: [embed] });

        } catch (error) {
            console.error('[!kalshi] Error:', error.message);
            await message.reply('❌ Error fetching Kalshi markets. Try again later.');
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

console.log('🚀 Starting bot...');
client.login(process.env.DISCORD_TOKEN);