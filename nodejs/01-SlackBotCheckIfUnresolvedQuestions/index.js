
/***
 * Enviroment Variables
 */
const target_date    = undefined; // optional
const bot_id         = process.env.BOT_ID;           // optional
const slack_token    = process.env.SLACK_TOKEN;      // required
let slack_webhook    = process.env.SLACK_WEBHOOK;    // required
let slack_channel_id = process.env.SLACK_CHANNEL_ID; // required

/***
 * Load Modules
 */
const axios               = require('axios');
const moment              = require('moment');
const { IncomingWebhook } = require('@slack/webhook');
const webhook             = new IncomingWebhook(slack_webhook);

/***
 * Function Variables
 */
const today              = moment(target_date).utc();
const moment_last_day    = moment(today).add(-14, 'days')
const slack_oldest       = moment_last_day.format("X");
const formatted_today    = today.toISOString();
const formatted_last_day = moment_last_day.toISOString();

console.log("Search Channel for specific stamp FROM: %s TO: %s", formatted_today, formatted_last_day);

/***
 * User Config Variables
 */
const slack_offset_limit = 500;
const target_reaction    = "zumi";
// Must order old -> new
const slack_text_array = [
  {"targetDay": 7, "slackText": ":boom: 未解決のまま一週間以上が経過。直接話した方が早いかも :boom:"},
  {"targetDay": 3, "slackText": ":kami: 未解決のまま3日以上が経過。至急回答を求む :kami:"},
  {"targetDay": 2, "slackText": ":fire: 未解決のまま2日が経過。早めの回答を！ :fire:"},
  {"targetDay": 1, "slackText": ":yatteiki: 未解決のまま1日が経過。回答しよ〜！ :yatteiki:"},
  {"targetDay": 0, "slackText": ":dart: 新着の質問です！ :dart:"}
];


// What to do?
// Fetch conversation history in channel id
// Check if it's messages[].user is not Bot
// Check if it's messages[].subtype is "thread_broadcast" or undefined.
// Check if it's messages.reactions[].name is NOT $target_reaction
//   -> No reactions
//   -> No $target_reaction
//   -> Include the rest of items in case of missing something
// Get Permanent link: https://api.slack.com/methods/chat.getPermalink
// Notify Slack with the links

// Fetch conversation history in channel id
const configWithAuth = {
    method: 'get',
    headers: { 'Authorization': 'Bearer ' + slack_token }
}
const conversationHistory = await axios.get(`https://slack.com/api/conversations.history?channel=${slack_channel_id}&limit=${slack_offset_limit}&oldest=${slack_oldest}`, configWithAuth)
    .then((res) => {
        console.log(res)
    return res.data;
    })
    .catch((err) => console.error(err));

if (typeof(conversationHistory.messages) === "undefined") {
    console.log("Exit since there is no available message.")
    return false
}
let unresolvedQuestions = [];

for(let i = 0; i < conversationHistory.messages.length; i++) {
    let message = conversationHistory.messages[i];

    // Check if it's messages[].user is not Bot
    if ( message.user === bot_id )
    continue
    
    // Check if it's messages[].subtype is "thread_broadcast" or undefined.
    if ( typeof(message.subtype) !== "undefined") {
    if (message.subtype !== "thread_broadcast")
        continue;
    }
    // Check if it's messages.reactions[].name is NOT $target_reaction
    // -> No reactions
    if ( typeof(message.reactions) === "undefined" ) {
    unresolvedQuestions.push(message.ts)
    continue
    }
    // -> No $target_reaction
    let isResolved = false;
    for(let i = 0; i < message.reactions.length; i++) {
    if( message.reactions[i].name === target_reaction ) {
        isResolved = true;
        break;
    }
    }
    if (isResolved) 
    continue;
    
    // -> Include the rest of items in case of missing something
    unresolvedQuestions.push(message.ts)
};

console.log("=== Target Questions: ", unresolvedQuestions)

// Get Permanent link: https://api.slack.com/methods/chat.getPermalink
let permanentLinkTargets = [];

unresolvedQuestions.forEach(timestamp => {
    permanentLinkTargets.push({ts: timestamp, url: `https://slack.com/api/chat.getPermalink?channel=${slack_channel_id}&message_ts=${timestamp}`})
})

// Ref: https://javascript.info/promise-api#promise-all
const allLinks = await Promise.all(permanentLinkTargets.map((obj) =>
    axios.get(obj.url, configWithAuth)
    .then((resp) => {
    return resp.data
    })
    .catch((err) => console.error(err))
));

let slackLinks = [];
console.log("=== Permanent Links: ", allLinks)
allLinks.map((link, index) => {
    let replacedResp = link.permalink.replace(/\\/g, '');
    let slack_text = `- <${replacedResp}|未解決の質問${index + 1}> `;
    for(let i = 0; i < slack_text_array.length; i++) {
        const oneDaySec         = 24*60*60;
        const targetDaySecTotal = oneDaySec*slack_text_array[i].targetDay;
        const diffSecFromToday  = today.format("X") - permanentLinkTargets[index].ts;
        // Any timestamp should hit at least :)
        if(diffSecFromToday >= targetDaySecTotal) {
        slack_text += slack_text_array[i].slackText;
        break;
        }
    };
    slackLinks.push({index: index+1, link: slack_text})
})
// Sort Z to A
slackLinks.sort(function(a,b) {
    return b.index - a.index;
});

let slack_text = "";
slackLinks.forEach(elem => {
    slack_text += elem.link + "\n";
})

// Notify Slack with the links
await webhook.send({
    text: `<#${slack_channel_id}> - 以下は :${target_reaction}: でない質問一覧です。(期間: ${formatted_last_day} - ${formatted_today})`,
    attachments: [{"text": slack_text }]
});

