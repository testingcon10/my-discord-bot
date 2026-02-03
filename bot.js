/**
 * VECTOR EDGE BOT v2.0 - Complete Implementation
 * Discord Bot with Live Data, Edge Detection, and Execution Layer
 */

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require('discord.js');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const fs = require('fs');
require('dotenv').config();

const ODDS_API_KEY = process.env.ODDS_API_KEY;
const ODDS_API_BASE = 'https://api.the-odds-api.com/v4';
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports';
const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2/markets';

const SPORT_KEYS = { 'NBA': 'basketball_nba', 'NFL': 'americanfootball_nfl', 'MLB': 'baseball_mlb', 'NHL': 'icehockey_nhl' };
const cache = { odds: new Map(), injuries: new Map(), kalshi: { data: null, timestamp: 0 } };
const CACHE_TTL = 30000;

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages],
    partials: [Partials.Channel]
});
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const conversationHistory = new Map();

// Utilities
const formatOdds = (o) => !o ? '—' : o > 0 ? `+${o}` : `${o}`;
const centsToAmerican = (c) => (!c || c <= 0 || c >= 100) ? null : c >= 50 ? Math.round(-(c/(100-c))*100) : Math.round(((100-c)/c)*100);
const americanToImplied = (o) => o < 0 ? Math.abs(o)/(Math.abs(o)+100) : 100/(o+100);

async function sendResponse(msg, text) {
    if (!text) return msg.reply('No response.');
    if (text.length <= 2000) return msg.reply(text);
    for (const chunk of text.match(/.{1,1900}/gs) || []) await msg.channel.send(chunk);
}

// API Functions
async function getOdds(sport = 'basketball_nba') {
    const key = `odds_${sport}`, cached = cache.odds.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;
    if (!ODDS_API_KEY) return [];
    try {
        const r = await axios.get(`${ODDS_API_BASE}/sports/${sport}/odds`, {
            params: { apiKey: ODDS_API_KEY, regions: 'us', markets: 'h2h,spreads,totals', oddsFormat: 'american' }, timeout: 15000
        });
        cache.odds.set(key, { data: r.data || [], timestamp: Date.now() });
        return r.data || [];
    } catch (e) { return cached?.data || []; }
}

async function getInjuries(sport = 'nba') {
    const key = `injuries_${sport}`, cached = cache.injuries.get(key);
    if (cached && Date.now() - cached.timestamp < 300000) return cached.data;
    const path = sport === 'nba' ? 'basketball/nba' : 'football/nfl';
    try {
        const r = await axios.get(`${ESPN_BASE}/${path}/injuries`, { timeout: 10000 });
        const injuries = [];
        for (const t of r.data.injuries || []) {
            for (const p of t.injuries || []) {
                injuries.push({ team: t.team?.abbreviation || '???', player: p.athlete?.displayName || '?', position: p.athlete?.position?.abbreviation || '', status: p.status || '?', injury: p.type?.detail || '?' });
            }
        }
        cache.injuries.set(key, { data: injuries, timestamp: Date.now() });
        return injuries;
    } catch (e) { return cached?.data || []; }
}

async function getESPNScoreboard(sport = 'nba') {
    const path = sport === 'nba' ? 'basketball/nba' : 'football/nfl';
    try { return (await axios.get(`${ESPN_BASE}/${path}/scoreboard`, { timeout: 10000 })).data.events || []; }
    catch (e) { return []; }
}

async function getKalshiMarkets(search = null) {
    if (cache.kalshi.data && Date.now() - cache.kalshi.timestamp < CACHE_TTL) {
        let m = cache.kalshi.data;
        if (search) m = m.filter(x => (x.title + x.ticker).toUpperCase().includes(search.toUpperCase()));
        return m;
    }
    try {
        const r = await axios.get(KALSHI_API, { params: { limit: 500, status: 'open' }, timeout: 10000 });
        let m = (r.data.markets || []).filter(x => !x.ticker?.includes('MULTIGAME'));
        cache.kalshi = { data: m, timestamp: Date.now() };
        if (search) m = m.filter(x => (x.title + x.ticker).toUpperCase().includes(search.toUpperCase()));
        return m;
    } catch (e) { return []; }
}

function getVectorEdges() {
    try { if (fs.existsSync('./vector_edges.json')) return JSON.parse(fs.readFileSync('./vector_edges.json', 'utf8')); } catch (e) {}
    return [];
}

function findBestOdds(game) {
    const result = { home: { best: -9999, book: null }, away: { best: -9999, book: null }, spread: { home: null, away: null }, total: { over: null, under: null } };
    for (const book of game.bookmakers || []) {
        const h2h = book.markets?.find(m => m.key === 'h2h');
        const spreads = book.markets?.find(m => m.key === 'spreads');
        const totals = book.markets?.find(m => m.key === 'totals');
        if (h2h) for (const o of h2h.outcomes || []) {
            if (o.name === game.home_team && o.price > result.home.best) result.home = { best: o.price, book: book.title };
            if (o.name === game.away_team && o.price > result.away.best) result.away = { best: o.price, book: book.title };
        }
        if (spreads) for (const o of spreads.outcomes || []) {
            if (o.name === game.home_team && (!result.spread.home || o.price > result.spread.home.price)) result.spread.home = { point: o.point, price: o.price, book: book.title };
            if (o.name === game.away_team && (!result.spread.away || o.price > result.spread.away.price)) result.spread.away = { point: o.point, price: o.price, book: book.title };
        }
        if (totals) for (const o of totals.outcomes || []) {
            if (o.name === 'Over' && (!result.total.over || o.price > result.total.over.price)) result.total.over = { point: o.point, price: o.price, book: book.title };
            if (o.name === 'Under' && (!result.total.under || o.price > result.total.under.price)) result.total.under = { point: o.point, price: o.price, book: book.title };
        }
    }
    return result;
}

function detectArbitrage(game) {
    const best = findBestOdds(game);
    const toDecimal = (o) => o > 0 ? (o/100)+1 : (100/Math.abs(o))+1;
    const total = (1/toDecimal(best.home.best)) + (1/toDecimal(best.away.best));
    if (total < 1) return { exists: true, profit: ((1/total - 1) * 100).toFixed(2), home: best.home, away: best.away };
    return { exists: false };
}

// Bot Events
client.on('ready', () => {
    console.log(`\n${'═'.repeat(50)}\n  VECTOR EDGE BOT v2.0 ONLINE\n  ${client.user.tag}\n${'═'.repeat(50)}\n`);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    const content = message.content.trim(), lower = content.toLowerCase();

    if (lower === '!help') {
        const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('🎰 Vector Edge Bot v2.0')
            .addFields(
                { name: '🔥 Edge Detection', value: '`!edge nba` `!edge [team]` `!arb`', inline: true },
                { name: '📊 Odds', value: '`!odds [team]` `!scan nba`', inline: true },
                { name: '🏥 Injuries', value: '`!injuries nba` `!injuries nfl`', inline: true },
                { name: '📺 Live', value: '`!live nba` `!live nfl`', inline: true },
                { name: '🔮 Markets', value: '`!kalshi [search]`', inline: true },
                { name: '🤖 AI', value: '`!ask [q]` `!clear`', inline: true }
            );
        return message.reply({ embeds: [embed] });
    }

    if (lower === '!clear') { conversationHistory.set(message.channel.id, []); return message.reply('🧹 Cleared'); }

    if (lower.startsWith('!injuries')) {
        const sport = content.slice(9).trim().toLowerCase() || 'nba';
        await message.channel.sendTyping();
        const injuries = await getInjuries(sport);
        if (!injuries.length) return message.reply(`No ${sport.toUpperCase()} injuries.`);
        const out = injuries.filter(i => i.status === 'Out').slice(0, 10);
        const fmt = (list) => list.length ? list.map(i => `**${i.team}** ${i.player} - ${i.injury}`).join('\n') : 'None';
        const embed = new EmbedBuilder().setColor(0xFF0000).setTitle(`🏥 ${sport.toUpperCase()} Injuries`)
            .addFields({ name: '❌ OUT', value: fmt(out), inline: false });
        return message.reply({ embeds: [embed] });
    }

    if (lower.startsWith('!live')) {
        const sport = content.slice(5).trim().toLowerCase() || 'nba';
        await message.channel.sendTyping();
        const events = await getESPNScoreboard(sport);
        if (!events.length) return message.reply(`No live ${sport.toUpperCase()} games.`);
        let text = '';
        for (const e of events.slice(0, 6)) {
            const c = e.competitions?.[0] || {}, h = c.competitors?.find(x => x.homeAway === 'home') || {}, a = c.competitors?.find(x => x.homeAway === 'away') || {};
            text += `**${a.team?.abbreviation} ${a.score || 0}** @ **${h.team?.abbreviation} ${h.score || 0}** - ${e.status?.type?.detail || ''}\n`;
        }
        const embed = new EmbedBuilder().setColor(0x00FF00).setTitle(`📺 Live ${sport.toUpperCase()}`).setDescription(text.trim());
        return message.reply({ embeds: [embed] });
    }

    if (lower === '!arb') {
        await message.channel.sendTyping();
        const [nba, nfl] = await Promise.all([getOdds('basketball_nba'), getOdds('americanfootball_nfl')]);
        const arbs = [...nba, ...nfl].map(g => ({ game: `${g.away_team} @ ${g.home_team}`, ...detectArbitrage(g) })).filter(a => a.exists);
        if (!arbs.length) return message.reply({ embeds: [new EmbedBuilder().setColor(0x99AAB5).setTitle('🔍 Arbitrage Scan').setDescription('No arbitrage opportunities found.')] });
        let text = arbs.slice(0, 5).map(a => `**${a.game}**\n${formatOdds(a.home.best)} @ ${a.home.book} | ${formatOdds(a.away.best)} @ ${a.away.book}\n💰 **${a.profit}% profit**`).join('\n\n');
        return message.reply({ embeds: [new EmbedBuilder().setColor(0xFFD700).setTitle('🔥 ARBITRAGE FOUND!').setDescription(text)] });
    }

    if (lower.startsWith('!scan')) {
        const sport = SPORT_KEYS[content.slice(5).trim().toUpperCase()] || 'basketball_nba';
        await message.channel.sendTyping();
        const odds = await getOdds(sport);
        if (!odds.length) return message.reply('No games found.');
        let text = '';
        for (const g of odds.slice(0, 5)) {
            const b = findBestOdds(g);
            text += `**${g.away_team} @ ${g.home_team}**\nML: ${formatOdds(b.away.best)} @ ${b.away.book} | ${formatOdds(b.home.best)} @ ${b.home.book}\n`;
            if (b.spread.home) text += `Spread: ${b.spread.home.point} (${formatOdds(b.spread.home.price)}) @ ${b.spread.home.book}\n`;
            text += '\n';
        }
        return message.reply({ embeds: [new EmbedBuilder().setColor(0x00AA00).setTitle('📊 Market Scan').setDescription(text.trim())] });
    }

    if (lower.startsWith('!odds')) {
        const q = content.slice(5).trim().toUpperCase();
        if (!q) return message.reply('Usage: `!odds [team]`');
        await message.channel.sendTyping();
        const all = [...await getOdds('basketball_nba'), ...await getOdds('americanfootball_nfl')];
        const game = all.find(g => g.home_team?.toUpperCase().includes(q) || g.away_team?.toUpperCase().includes(q));
        if (!game) return message.reply(`No game for "${q}"`);
        const b = findBestOdds(game), arb = detectArbitrage(game);
        let desc = `**${game.away_team} @ ${game.home_team}**\n\n`;
        if (arb.exists) desc += `🔥 **ARBITRAGE: ${arb.profit}%**\n\n`;
        desc += `**ML:** ${game.away_team} ${formatOdds(b.away.best)} @ ${b.away.book}\n${game.home_team} ${formatOdds(b.home.best)} @ ${b.home.book}\n`;
        if (b.spread.home) desc += `\n**Spread:** ${b.spread.home.point} (${formatOdds(b.spread.home.price)}) @ ${b.spread.home.book}`;
        if (b.total.over) desc += `\n**Total:** O${b.total.over.point} (${formatOdds(b.total.over.price)}) @ ${b.total.over.book}`;
        return message.reply({ embeds: [new EmbedBuilder().setColor(arb.exists ? 0xFFD700 : 0x00FF88).setTitle(`🎰 ${q}`).setDescription(desc)] });
    }

    if (lower.startsWith('!edge')) {
        const q = content.slice(5).trim().toUpperCase();
        await message.channel.sendTyping();
        const vec = getVectorEdges();
        if (q && vec.length) {
            const edge = vec.find(e => e.team?.toUpperCase().includes(q) || e.opponent?.toUpperCase().includes(q));
            if (edge) {
                const embed = new EmbedBuilder().setColor(edge.status === 'STRONG_EDGE' ? 0xFF4500 : 0x00FF00)
                    .setTitle(`🎯 ${edge.team} vs ${edge.opponent}`).setDescription(`**${edge.status}** | Sample: ${edge.sample_size}`);
                for (const e of edge.edges || []) embed.addFields({ name: `${e.type}: ${e.direction}`, value: `Edge: **${e.advantage > 0 ? '+' : ''}${e.advantage}%**`, inline: true });
                return message.reply({ embeds: [embed] });
            }
        }
        const odds = await getOdds(SPORT_KEYS[q] || 'basketball_nba');
        if (!odds.length) return message.reply('No games.');
        let text = '';
        for (const g of odds.slice(0, 5)) {
            const b = findBestOdds(g), arb = detectArbitrage(g);
            const vig = ((americanToImplied(b.home.best) + americanToImplied(b.away.best) - 1) * 100).toFixed(1);
            text += `${arb.exists ? '🔥' : vig < 4 ? '✅' : '⚖️'} **${g.away_team} @ ${g.home_team}** | Vig: ${vig}%${arb.exists ? ` | Arb: ${arb.profit}%` : ''}\n`;
        }
        return message.reply({ embeds: [new EmbedBuilder().setColor(0xFF6B35).setTitle(`🎯 Edge Analysis`).setDescription(text).setFooter({ text: '🔥=Arb ✅=Low vig ⚖️=Normal' })] });
    }

    if (lower.startsWith('!kalshi')) {
        const search = content.slice(7).trim() || null;
        await message.channel.sendTyping();
        const markets = await getKalshiMarkets(search);
        if (!markets.length) return message.reply(search ? `No Kalshi markets for "${search}"` : 'No markets.');
        let text = markets.slice(0, 8).map(m => `**${m.title?.slice(0, 45)}**\nYes: ${m.yes_bid || 50}¢ (${formatOdds(centsToAmerican(m.yes_bid || 50))})`).join('\n\n');
        return message.reply({ embeds: [new EmbedBuilder().setColor(0x6B5BFF).setTitle(search ? `🔮 Kalshi: "${search}"` : '🔮 Kalshi').setDescription(text)] });
    }

    if (lower.startsWith('!ask ')) {
        const q = content.slice(5).trim();
        if (!q) return;
        try {
            let h = conversationHistory.get(message.channel.id) || [];
            h.push({ role: 'user', content: q });
            await message.channel.sendTyping();
            const r = await anthropic.messages.create({ model: 'claude-sonnet-4-20250514', max_tokens: 1024, system: 'Sports betting analyst. Be concise.', messages: h });
            const ans = r.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
            h.push({ role: 'assistant', content: ans });
            if (h.length > 20) h = h.slice(-20);
            conversationHistory.set(message.channel.id, h);
            await sendResponse(message, ans);
        } catch (e) { await message.reply(`Error: ${e.message}`); }
    }
});

console.log('Starting Vector Edge Bot v2.0...');
client.login(process.env.DISCORD_TOKEN);
