import type {
  AskAnswer,
  CaseRecord,
  Interaction,
  LabelDef,
  Queue,
  Theme,
} from './types'

export const QUEUES: Queue[] = [
  'Cards and checks',
  'Payments',
  'Account access',
  'General enquiries',
]

export const OVERALL = {
  calls: 1446,
  callsPrev: 1364,
  aht: 62,
  ahtPrev: 58,
  negativeShare: 0.18,
  negativePrev: 0.15,
  repeatShare: 0.11,
  repeatPrev: 0.09,
  freshness: 'Mock gold tables · 22 Oct 2026',
}

export const CONTACT_REASONS = [
  { name: 'Pay bill', share: 0.18 },
  { name: 'Transfer money', share: 0.16 },
  { name: 'Check balance', share: 0.15 },
  { name: 'Replace card', share: 0.13 },
  { name: 'Reset password', share: 0.12 },
  { name: 'Order checks', share: 0.1 },
  { name: 'Schedule appointment', share: 0.09 },
  { name: 'Get branch hours', share: 0.07 },
]

export const DAILY = [
  { date: '15 Oct', volume: 198, negative: 0.14 },
  { date: '16 Oct', volume: 212, negative: 0.15 },
  { date: '17 Oct', volume: 90, negative: 0.12 },
  { date: '18 Oct', volume: 74, negative: 0.11 },
  { date: '19 Oct', volume: 221, negative: 0.17 },
  { date: '20 Oct', volume: 236, negative: 0.21 },
  { date: '21 Oct', volume: 248, negative: 0.22 },
  { date: '22 Oct', volume: 167, negative: 0.19 },
]

export const CHANGES = [
  {
    kind: 'theme' as const,
    id: 'dup-charge',
    title: 'Duplicate bill-pay charge calls up 40% week over week',
    detail: '218 calls · handle time 1m 48s · mostly Payments queue',
  },
  {
    kind: 'theme' as const,
    id: 'pwd-reset',
    title: 'Password reset handle time up 18s',
    detail: '174 calls · longer silences during verification',
  },
  {
    kind: 'label' as const,
    id: 'reverify',
    title: '“Customer repeats account number” up 22%',
    detail: 'Tracked label · mostly after transfers',
  },
]

export const INTERACTIONS: Interaction[] = [
  {
    id: 'C-20481',
    startedAt: '2026-10-21T14:12:00',
    durationSeconds: 108,
    queue: 'Payments',
    agentId: 'ag-patel',
    agentName: 'Jay Patel',
    customerId: 'cu-4412',
    contactReason: 'Pay bill',
    sentimentStart: 'negative',
    sentimentEnd: 'neutral',
    resolution: 'transferred',
    summary:
      'Repeat caller disputing a duplicate $89 bill-pay charge. Agent confirmed both charges, placed the customer on a short hold, then transferred to billing. Not resolved on this call.',
    themes: ['dup-charge'],
    labels: ['reverify'],
    repeatContact: true,
    transferCount: 1,
    talkRatioAgent: 0.58,
    longestSilence: 12,
    overtalkCount: 1,
    holdCount: 1,
    keyMoments: [
      { label: 'Identity verified', start: 13, quote: "Thanks, you're verified. How can I help today?" },
      { label: 'Customer says it is a repeat call', start: 34, quote: "That's the second time I've had to explain this." },
      { label: 'Hold, 12s', start: 68, quote: "I'll pop you on a short hold while I check with billing." },
      { label: 'Transfer to billing', start: 88, quote: "I'm transferring you to our billing team." },
    ],
    segments: [
      { idx: 1, start: 2, end: 7, role: 'agent', text: 'Thanks for calling Harper Valley Bank, this is Jay. Can I get your account number?' },
      { idx: 2, start: 8, end: 12, role: 'customer', text: "Sure, it's four four seven one two two zero eight." },
      { idx: 3, start: 13, end: 18, role: 'agent', text: "Thanks, you're verified. How can I help today?" },
      { idx: 4, start: 19, end: 32, role: 'customer', text: "I've been charged twice for October, and I already called about this last week." },
      { idx: 5, start: 34, end: 42, role: 'customer', text: "That's the second time I've had to explain this. I just want the duplicate charge refunded." },
      { idx: 6, start: 43, end: 58, role: 'agent', text: "I'm sorry about that. I can see two payments of eighty nine dollars on the third. Let me check what I can do." },
      { idx: 7, start: 68, end: 80, role: 'agent', text: "I'll pop you on a short hold while I check with billing.", event: 'Hold 12s' },
      { idx: 8, start: 88, end: 96, role: 'agent', text: "I'm transferring you to our billing team, who can process the refund." },
      { idx: 9, start: 97, end: 104, role: 'customer', text: 'Will I have to give my account number again?' },
    ],
  },
  {
    id: 'C-20377',
    startedAt: '2026-10-20T10:04:00',
    durationSeconds: 74,
    queue: 'Payments',
    agentId: 'ag-chen',
    agentName: 'Mina Chen',
    customerId: 'cu-1188',
    contactReason: 'Pay bill',
    sentimentStart: 'negative',
    sentimentEnd: 'negative',
    resolution: 'unresolved',
    summary:
      'Customer sees two $89 payments on their card from the 3rd and wants the second reversed on the line. Agent could not reverse it and offered a callback.',
    themes: ['dup-charge'],
    labels: [],
    repeatContact: false,
    transferCount: 0,
    talkRatioAgent: 0.52,
    longestSilence: 6,
    overtalkCount: 0,
    holdCount: 0,
    keyMoments: [
      { label: 'Duplicate charge named', start: 18, quote: 'I can see two payments of eighty nine dollars on my card from the third.' },
    ],
    segments: [
      { idx: 1, start: 1, end: 6, role: 'agent', text: 'Harper Valley Bank, Mina speaking. How can I help?' },
      { idx: 2, start: 7, end: 16, role: 'customer', text: 'I need to talk about a bill payment that posted twice.' },
      { idx: 3, start: 18, end: 28, role: 'customer', text: 'I can see two payments of eighty nine dollars on my card from the third.' },
      { idx: 4, start: 30, end: 44, role: 'agent', text: 'I see both of those. I cannot reverse the second one from this queue. I can schedule a billing callback.' },
      { idx: 5, start: 46, end: 58, role: 'customer', text: 'Can you just reverse the second charge while I am on the line?' },
      { idx: 6, start: 60, end: 72, role: 'agent', text: 'Not from here. I will note the dispute and someone from billing will call you today.' },
    ],
  },
  {
    id: 'C-20215',
    startedAt: '2026-10-20T16:41:00',
    durationSeconds: 66,
    queue: 'Payments',
    agentId: 'ag-patel',
    agentName: 'Jay Patel',
    customerId: 'cu-7721',
    contactReason: 'Pay bill',
    sentimentStart: 'neutral',
    sentimentEnd: 'neutral',
    resolution: 'resolved',
    summary:
      'Customer noticed a possible duplicate but accepted that one payment was a scheduled pay-bill and one was a card presentment. Resolved without a refund.',
    themes: ['dup-charge'],
    labels: [],
    repeatContact: false,
    transferCount: 0,
    talkRatioAgent: 0.61,
    longestSilence: 4,
    overtalkCount: 0,
    holdCount: 0,
    keyMoments: [
      { label: 'Explains both postings', start: 24, quote: 'One is the scheduled bill pay, the other is the merchant presentment.' },
    ],
    segments: [
      { idx: 1, start: 1, end: 5, role: 'agent', text: 'Thanks for calling, this is Jay.' },
      { idx: 2, start: 6, end: 18, role: 'customer', text: 'There are two charges that look the same and I wanted to check before I dispute them.' },
      { idx: 3, start: 20, end: 38, role: 'agent', text: 'One is the scheduled bill pay, the other is the merchant presentment. Only one left your account.' },
      { idx: 4, start: 40, end: 52, role: 'customer', text: 'Got it. So I do not need a refund.' },
      { idx: 5, start: 54, end: 62, role: 'agent', text: 'Correct. I will send a confirmation to your email.' },
    ],
  },
  {
    id: 'C-19877',
    startedAt: '2026-10-19T11:22:00',
    durationSeconds: 94,
    queue: 'Payments',
    agentId: 'ag-ross',
    agentName: 'Alex Ross',
    customerId: 'cu-3301',
    contactReason: 'Transfer money',
    sentimentStart: 'negative',
    sentimentEnd: 'neutral',
    resolution: 'resolved',
    summary:
      'Customer transferred money, was handed to a second agent, and had to re-verify. They completed the transfer but complained about repeating identity details.',
    themes: ['reverify-xfer'],
    labels: ['reverify', 'xfer-intent'],
    repeatContact: false,
    transferCount: 1,
    talkRatioAgent: 0.55,
    longestSilence: 5,
    overtalkCount: 2,
    holdCount: 0,
    keyMoments: [
      { label: 'Transfer request', start: 12, quote: 'I want to move money from checking to savings.' },
      { label: 'Re-verification', start: 48, quote: 'I gave all of this to the last person already.' },
    ],
    segments: [
      { idx: 1, start: 1, end: 6, role: 'agent', text: 'Harper Valley Bank, Alex speaking. Account number please?' },
      { idx: 2, start: 7, end: 11, role: 'customer', text: 'Four four seven one, two two zero eight.' },
      { idx: 3, start: 12, end: 18, role: 'customer', text: 'I want to move money from checking to savings.' },
      { idx: 4, start: 20, end: 32, role: 'agent', text: 'I am going to send you to our transfers desk. They will pick this up.' },
      { idx: 5, start: 40, end: 46, role: 'agent', text: 'Hi, this is Alex on transfers. Can I get your account number and date of birth?' },
      { idx: 6, start: 48, end: 58, role: 'customer', text: 'I gave all of this to the last person already.' },
      { idx: 7, start: 60, end: 72, role: 'agent', text: 'I know, policy after a transfer. Once I have it I can move the money.' },
      { idx: 8, start: 74, end: 80, role: 'customer', text: 'Fine. Same account, date of birth March twelfth seventy nine.' },
      { idx: 9, start: 82, end: 92, role: 'agent', text: 'Done. Two hundred dollars from checking to savings. You will see it today.' },
    ],
  },
  {
    id: 'C-20112',
    startedAt: '2026-10-18T09:15:00',
    durationSeconds: 58,
    queue: 'Account access',
    agentId: 'ag-chen',
    agentName: 'Mina Chen',
    customerId: 'cu-5502',
    contactReason: 'Reset password',
    sentimentStart: 'neutral',
    sentimentEnd: 'positive',
    resolution: 'resolved',
    summary:
      'Password reset with a second identity check mid-call. Customer asked whether the account number was needed again, then completed the reset.',
    themes: ['pwd-reset'],
    labels: ['reverify'],
    repeatContact: false,
    transferCount: 0,
    talkRatioAgent: 0.57,
    longestSilence: 8,
    overtalkCount: 0,
    holdCount: 0,
    keyMoments: [
      { label: 'Asks for account number again', start: 22, quote: 'Sorry, do you need the account number again for this part?' },
    ],
    segments: [
      { idx: 1, start: 1, end: 6, role: 'agent', text: 'This is Mina. I can help reset your password. Account number?' },
      { idx: 2, start: 7, end: 12, role: 'customer', text: 'Four four seven one two two zero eight.' },
      { idx: 3, start: 14, end: 20, role: 'agent', text: 'And for the reset itself I need the account number on the profile again.' },
      { idx: 4, start: 22, end: 28, role: 'customer', text: 'Sorry, do you need the account number again for this part?' },
      { idx: 5, start: 30, end: 40, role: 'agent', text: 'Yes. Once I confirm it I will text you a one time code.' },
      { idx: 6, start: 42, end: 48, role: 'customer', text: 'Okay, same number.' },
      { idx: 7, start: 50, end: 56, role: 'agent', text: 'Code sent. You are all set once you enter it.' },
    ],
  },
  {
    id: 'C-19640',
    startedAt: '2026-10-21T08:50:00',
    durationSeconds: 81,
    queue: 'Account access',
    agentId: 'ag-ross',
    agentName: 'Alex Ross',
    customerId: 'cu-2209',
    contactReason: 'Reset password',
    sentimentStart: 'negative',
    sentimentEnd: 'neutral',
    resolution: 'resolved',
    summary:
      'Long silence while the agent waited on the identity tool. Password was reset after the customer repeated their last four.',
    themes: ['pwd-reset'],
    labels: [],
    repeatContact: false,
    transferCount: 0,
    talkRatioAgent: 0.49,
    longestSilence: 18,
    overtalkCount: 0,
    holdCount: 0,
    keyMoments: [
      { label: 'Long verification silence', start: 28, quote: 'Give me a moment while this screen loads.' },
    ],
    segments: [
      { idx: 1, start: 1, end: 5, role: 'agent', text: 'Harper Valley Bank, Alex. How can I help?' },
      { idx: 2, start: 6, end: 14, role: 'customer', text: 'I cannot get into online banking. I need a password reset.' },
      { idx: 3, start: 16, end: 26, role: 'agent', text: 'I can do that. Last four of the account and your date of birth please.' },
      { idx: 4, start: 28, end: 46, role: 'agent', text: 'Give me a moment while this screen loads.', event: 'Silence 18s' },
      { idx: 5, start: 48, end: 56, role: 'customer', text: 'Are you still there?' },
      { idx: 6, start: 58, end: 70, role: 'agent', text: 'Yes, sorry. Reset sent. Check your phone for the code.' },
      { idx: 7, start: 72, end: 78, role: 'customer', text: 'Got it. Thanks.' },
    ],
  },
  {
    id: 'C-19002',
    startedAt: '2026-10-16T13:05:00',
    durationSeconds: 54,
    queue: 'Payments',
    agentId: 'ag-patel',
    agentName: 'Jay Patel',
    customerId: 'cu-8804',
    contactReason: 'Transfer money',
    sentimentStart: 'positive',
    sentimentEnd: 'positive',
    resolution: 'resolved',
    summary:
      'Straightforward transfer of $200 from checking to savings. Identity checked once. No re-verification.',
    themes: [],
    labels: ['xfer-intent'],
    repeatContact: false,
    transferCount: 0,
    talkRatioAgent: 0.54,
    longestSilence: 2,
    overtalkCount: 0,
    holdCount: 0,
    keyMoments: [
      { label: 'Transfer completed', start: 28, quote: 'Two hundred from checking to savings, done.' },
    ],
    segments: [
      { idx: 1, start: 1, end: 5, role: 'agent', text: 'Jay at Harper Valley Bank. Account number?' },
      { idx: 2, start: 6, end: 10, role: 'customer', text: 'Four four seven one two two zero eight.' },
      { idx: 3, start: 12, end: 18, role: 'customer', text: 'I would like to move two hundred dollars into savings.' },
      { idx: 4, start: 20, end: 36, role: 'agent', text: 'Two hundred from checking to savings, done. Anything else?' },
      { idx: 5, start: 38, end: 44, role: 'customer', text: 'That is it, thank you.' },
      { idx: 6, start: 46, end: 50, role: 'agent', text: 'Have a good day.' },
    ],
  },
  {
    id: 'C-18811',
    startedAt: '2026-10-15T15:33:00',
    durationSeconds: 47,
    queue: 'Cards and checks',
    agentId: 'ag-chen',
    agentName: 'Mina Chen',
    customerId: 'cu-6610',
    contactReason: 'Replace card',
    sentimentStart: 'neutral',
    sentimentEnd: 'positive',
    resolution: 'resolved',
    summary: 'Customer reported a worn debit card. Agent ordered a replacement to the address on file.',
    themes: [],
    labels: [],
    repeatContact: false,
    transferCount: 0,
    talkRatioAgent: 0.6,
    longestSilence: 3,
    overtalkCount: 0,
    holdCount: 0,
    keyMoments: [
      { label: 'Replacement ordered', start: 22, quote: 'I will send a new card to the address on file.' },
    ],
    segments: [
      { idx: 1, start: 1, end: 5, role: 'agent', text: 'Mina at Harper Valley Bank. How can I help?' },
      { idx: 2, start: 6, end: 16, role: 'customer', text: 'My debit card is peeling. I need a new one.' },
      { idx: 3, start: 18, end: 32, role: 'agent', text: 'I will send a new card to the address on file. Five to seven days.' },
      { idx: 4, start: 34, end: 40, role: 'customer', text: 'Perfect, thanks.' },
    ],
  },
  {
    id: 'C-18550',
    startedAt: '2026-10-22T09:08:00',
    durationSeconds: 41,
    queue: 'General enquiries',
    agentId: 'ag-ross',
    agentName: 'Alex Ross',
    customerId: 'cu-1022',
    contactReason: 'Get branch hours',
    sentimentStart: 'neutral',
    sentimentEnd: 'neutral',
    resolution: 'resolved',
    summary: 'Customer asked for Saturday hours at the downtown branch.',
    themes: [],
    labels: [],
    repeatContact: false,
    transferCount: 0,
    talkRatioAgent: 0.62,
    longestSilence: 1,
    overtalkCount: 0,
    holdCount: 0,
    keyMoments: [
      { label: 'Hours given', start: 14, quote: 'Downtown is open nine to noon on Saturday.' },
    ],
    segments: [
      { idx: 1, start: 1, end: 4, role: 'agent', text: 'Harper Valley Bank, Alex.' },
      { idx: 2, start: 5, end: 12, role: 'customer', text: 'What time does the downtown branch open on Saturday?' },
      { idx: 3, start: 14, end: 24, role: 'agent', text: 'Downtown is open nine to noon on Saturday.' },
      { idx: 4, start: 26, end: 32, role: 'customer', text: 'Thanks, that is all.' },
    ],
  },
  {
    id: 'C-18402',
    startedAt: '2026-10-21T17:40:00',
    durationSeconds: 88,
    queue: 'Payments',
    agentId: 'ag-patel',
    agentName: 'Jay Patel',
    customerId: 'cu-4412',
    contactReason: 'Transfer money',
    sentimentStart: 'negative',
    sentimentEnd: 'negative',
    resolution: 'transferred',
    summary:
      'Same customer as C-20481, now trying to move money after the bill-pay dispute. Re-verified after being transferred to the transfers desk.',
    themes: ['reverify-xfer'],
    labels: ['reverify', 'xfer-intent'],
    repeatContact: true,
    transferCount: 1,
    talkRatioAgent: 0.53,
    longestSilence: 7,
    overtalkCount: 1,
    holdCount: 0,
    keyMoments: [
      { label: 'Asks to move money', start: 16, quote: 'I also need to move money between my accounts.' },
      { label: 'Asked for ID again', start: 52, quote: 'Will I have to give my account number again?' },
    ],
    segments: [
      { idx: 1, start: 1, end: 6, role: 'agent', text: 'Jay at Harper Valley Bank. How can I help?' },
      { idx: 2, start: 8, end: 20, role: 'customer', text: 'I also need to move money between my accounts after that duplicate bill pay.' },
      { idx: 3, start: 22, end: 34, role: 'agent', text: 'I will transfer you to the transfers desk. They handle account to account moves.' },
      { idx: 4, start: 42, end: 50, role: 'agent', text: 'Transfers desk, can I have your account number to pull up the profile?' },
      { idx: 5, start: 52, end: 58, role: 'customer', text: 'Will I have to give my account number again?' },
      { idx: 6, start: 60, end: 70, role: 'agent', text: 'Yes, we do not keep it from the previous agent.' },
      { idx: 7, start: 72, end: 86, role: 'customer', text: 'This is why I keep calling. Fine, four four seven one two two zero eight.' },
    ],
  },
]

export const THEMES: Theme[] = [
  {
    id: 'dup-charge',
    name: 'Duplicate bill-pay charge',
    summary:
      'Customers are disputing a second $89 bill-pay posting after a payments change on 14 Oct. Most want a refund on the line; many are transferred to billing and some are repeat callers.',
    count: 218,
    countChangePct: 0.4,
    ahtSeconds: 108,
    ahtVsOverall: 46,
    repeatRate: 0.19,
    repeatVsOverall: 0.08,
    extraAgentHours: 2.8,
    drivers: [
      { name: 'Duplicate charge', share: 0.46 },
      { name: 'Cannot reverse on the line', share: 0.28 },
      { name: 'Scheduled vs merchant posting', share: 0.16 },
      { name: 'Other', share: 0.1 },
    ],
    byQueue: [
      { queue: 'Payments', count: 174, ahtSeconds: 112 },
      { queue: 'General enquiries', count: 28, ahtSeconds: 96 },
      { queue: 'Account access', count: 16, ahtSeconds: 88 },
    ],
    daily: [
      { date: '16 Oct', count: 12 },
      { date: '17 Oct', count: 8 },
      { date: '18 Oct', count: 10 },
      { date: '19 Oct', count: 34 },
      { date: '20 Oct', count: 48 },
      { date: '21 Oct', count: 62 },
      { date: '22 Oct', count: 44 },
    ],
    representativeIds: ['C-20481', 'C-20377', 'C-20215'],
  },
  {
    id: 'reverify-xfer',
    name: 'Re-verification after transfer',
    summary:
      'After an internal transfer, a second agent asks for account number or date of birth again. Customers notice and often object. Strong overlap with money-movement calls.',
    count: 96,
    countChangePct: 0.22,
    ahtSeconds: 91,
    ahtVsOverall: 29,
    repeatRate: 0.14,
    repeatVsOverall: 0.03,
    extraAgentHours: 0.8,
    drivers: [
      { name: 'Internal queue transfer', share: 0.71 },
      { name: 'Tool did not carry identity', share: 0.19 },
      { name: 'Other', share: 0.1 },
    ],
    byQueue: [
      { queue: 'Payments', count: 64, ahtSeconds: 94 },
      { queue: 'Account access', count: 22, ahtSeconds: 86 },
      { queue: 'Cards and checks', count: 10, ahtSeconds: 80 },
    ],
    daily: [
      { date: '16 Oct', count: 8 },
      { date: '17 Oct', count: 4 },
      { date: '18 Oct', count: 7 },
      { date: '19 Oct', count: 14 },
      { date: '20 Oct', count: 18 },
      { date: '21 Oct', count: 26 },
      { date: '22 Oct', count: 19 },
    ],
    representativeIds: ['C-19877', 'C-18402'],
  },
  {
    id: 'pwd-reset',
    name: 'Password reset verification delay',
    summary:
      'Identity checks during password reset are slower than last week, with silences while a screen loads and occasional repeat of the account number.',
    count: 174,
    countChangePct: 0.08,
    ahtSeconds: 80,
    ahtVsOverall: 18,
    repeatRate: 0.09,
    repeatVsOverall: -0.02,
    extraAgentHours: 0.9,
    drivers: [
      { name: 'Identity tool lag', share: 0.52 },
      { name: 'Second account-number prompt', share: 0.31 },
      { name: 'Other', share: 0.17 },
    ],
    byQueue: [
      { queue: 'Account access', count: 148, ahtSeconds: 82 },
      { queue: 'General enquiries', count: 26, ahtSeconds: 70 },
    ],
    daily: [
      { date: '16 Oct', count: 22 },
      { date: '17 Oct', count: 10 },
      { date: '18 Oct', count: 18 },
      { date: '19 Oct', count: 28 },
      { date: '20 Oct', count: 30 },
      { date: '21 Oct', count: 36 },
      { date: '22 Oct', count: 30 },
    ],
    representativeIds: ['C-20112', 'C-19640'],
  },
]

const REVERIFY_SAMPLE: LabelDef['sample'] = [
  {
    interactionId: 'C-20481',
    matched: true,
    confidence: 'high',
    evidenceQuote: 'Will I have to give my account number again?',
    evidenceStart: 97,
    reason: 'Customer objects to a second identity request after a transfer.',
    grounded: true,
    verdict: 'correct',
  },
  {
    interactionId: 'C-19877',
    matched: true,
    confidence: 'high',
    evidenceQuote: 'I gave all of this to the last person already.',
    evidenceStart: 48,
    reason: 'Customer already verified with the previous agent.',
    grounded: true,
  },
  {
    interactionId: 'C-20112',
    matched: true,
    confidence: 'medium',
    evidenceQuote: 'Sorry, do you need the account number again for this part?',
    evidenceStart: 22,
    reason: 'Customer is asked for the account number a second time in-call.',
    grounded: true,
  },
  {
    interactionId: 'C-18402',
    matched: true,
    confidence: 'high',
    evidenceQuote: 'Will I have to give my account number again?',
    evidenceStart: 52,
    reason: 'Second agent requests the account number after a desk transfer.',
    grounded: true,
  },
  {
    interactionId: 'C-19002',
    matched: false,
    confidence: 'high',
    evidenceQuote: 'Jay at Harper Valley Bank. Account number?',
    evidenceStart: 1,
    reason: 'Identity is collected once; no repeat after a transfer.',
    grounded: true,
  },
]

export const INITIAL_LABELS: LabelDef[] = [
  {
    id: 'reverify',
    name: 'Customer repeats account number',
    owner: 'you',
    status: 'active',
    tracked: true,
    version: 2,
    definition:
      'The customer is asked for their account number or identity details more than once in the same call, for example after a transfer.',
    includeExamples: 'Will I have to give my account number again?\nI gave all of this to the last person already.',
    excludeExamples: 'Account number please? (first request of the call)',
    speakerFocus: 'any',
    matchShare: 0.14,
    matchedCount: 202,
    scopeCount: 1446,
    agreement: { correct: 18, reviewed: 20 },
    lastRun: '2026-10-22',
    byQueue: [
      { queue: 'Payments', share: 0.22 },
      { queue: 'Account access', share: 0.15 },
      { queue: 'Cards and checks', share: 0.09 },
      { queue: 'General enquiries', share: 0.04 },
    ],
    sample: REVERIFY_SAMPLE,
  },
  {
    id: 'xfer-intent',
    name: 'Caller wants to move money',
    owner: 'you',
    status: 'tested',
    tracked: false,
    version: 1,
    definition:
      'The caller wants to move money between their own accounts at Harper Valley Bank (checking to savings or similar).',
    includeExamples: 'I want to move money from checking to savings.',
    excludeExamples: 'I need to pay a bill.',
    speakerFocus: 'customer',
    matchShare: 0.16,
    matchedCount: 231,
    scopeCount: 1446,
    agreement: { correct: 19, reviewed: 20 },
    lastRun: '2026-10-21',
    byQueue: [
      { queue: 'Payments', share: 0.41 },
      { queue: 'Account access', share: 0.06 },
      { queue: 'General enquiries', share: 0.03 },
      { queue: 'Cards and checks', share: 0.02 },
    ],
    sample: [
      {
        interactionId: 'C-19877',
        matched: true,
        confidence: 'high',
        evidenceQuote: 'I want to move money from checking to savings.',
        evidenceStart: 12,
        reason: 'Explicit request to move money between accounts.',
        grounded: true,
        verdict: 'correct',
      },
      {
        interactionId: 'C-19002',
        matched: true,
        confidence: 'high',
        evidenceQuote: 'I would like to move two hundred dollars into savings.',
        evidenceStart: 12,
        reason: 'Customer asks to move a specific amount into savings.',
        grounded: true,
        verdict: 'correct',
      },
      {
        interactionId: 'C-20481',
        matched: false,
        confidence: 'high',
        evidenceQuote: 'I just want the duplicate charge refunded.',
        evidenceStart: 34,
        reason: 'This call is a bill-pay dispute, not a transfer.',
        grounded: true,
      },
    ],
  },
]

export const INITIAL_CASES: CaseRecord[] = [
  {
    id: 'case-dup',
    title: 'Duplicate bill-pay postings after 14 Oct',
    owner: 'you',
    updatedAt: '2026-10-22',
    impactLabel: 'dup-charge',
    items: [
      {
        id: 'i1',
        type: 'theme',
        refId: 'dup-charge',
        note: 'Spike starts 19 Oct, mostly Payments.',
      },
      {
        id: 'i2',
        type: 'clip',
        refId: 'C-20481',
        start: 34,
        end: 42,
        note: 'Customer names the repeat call and wants the refund on the line.',
      },
      {
        id: 'i3',
        type: 'clip',
        refId: 'C-20377',
        start: 18,
        end: 28,
        note: 'Two payments of $89 on the 3rd.',
      },
    ],
  },
]

export const STARTER_QUESTIONS = [
  'Why are payments calls taking longer this week?',
  'How often are customers re-verified after a transfer?',
  'Which queue has the highest negative sentiment?',
  'Show calls that mention a duplicate charge',
]

export function answerQuestion(q: string): AskAnswer {
  const lower = q.toLowerCase()
  if (lower.includes('re-verif') || lower.includes('account number')) {
    return {
      question: q,
      prose:
        'About 14% of calls match the tracked label “Customer repeats account number”. 71% of those matches happen after an internal transfer. AI-generated — verify against the transcript.',
      sql: `SELECT queue, COUNT(*) AS matches
FROM label_results r
JOIN interactions i USING (interaction_id)
WHERE r.label_id = 'reverify' AND r.matched
GROUP BY queue
ORDER BY matches DESC`,
      columns: ['queue', 'matches', 'share'],
      rows: [
        { cells: ['Payments', '141', '22%'], href: '#/labels/reverify' },
        { cells: ['Account access', '26', '15%'] },
        { cells: ['Cards and checks', '19', '9%'] },
      ],
    }
  }
  if (lower.includes('duplicate') || lower.includes('longer') || lower.includes('payment')) {
    return {
      question: q,
      prose:
        'Payments handle time is up because of the Duplicate bill-pay charge theme: 218 calls, +40% vs last week, 46s above overall AHT. Representative calls are linked below. AI-generated — verify.',
      sql: `SELECT theme_id, COUNT(*) AS calls, AVG(duration_seconds) AS aht
FROM theme_membership m
JOIN interactions i USING (interaction_id)
WHERE i.started_at >= '2026-10-16'
GROUP BY theme_id
ORDER BY calls DESC`,
      columns: ['theme', 'calls', 'aht', 'change'],
      rows: [
        { cells: ['Duplicate bill-pay charge', '218', '1m 48s', '+40%'], href: '#/themes/dup-charge' },
        { cells: ['Password reset delay', '174', '1m 20s', '+8%'], href: '#/themes/pwd-reset' },
        { cells: ['Re-verification after transfer', '96', '1m 31s', '+22%'], href: '#/themes/reverify-xfer' },
      ],
    }
  }
  if (lower.includes('sentiment')) {
    return {
      question: q,
      prose:
        'Negative-end sentiment is highest in Payments (24%), then Account access (17%). Overall negative share is 18%, +3 pts vs the prior week. AI-generated — verify.',
      sql: `SELECT queue,
  AVG(CASE WHEN sentiment_end = 'negative' THEN 1 ELSE 0 END) AS neg
FROM interaction_enrichment e
JOIN interactions i USING (interaction_id)
GROUP BY queue
ORDER BY neg DESC`,
      columns: ['queue', 'negative share', 'calls'],
      rows: [
        { cells: ['Payments', '24%', '412'] },
        { cells: ['Account access', '17%', '368'] },
        { cells: ['Cards and checks', '14%', '334'] },
        { cells: ['General enquiries', '11%', '332'] },
      ],
    }
  }
  return {
    question: q,
    prose:
      'In this local MVP, Ask is mocked. In M3 it will run through a Genie space on the gold tables. Try a starter question, or open Explore. AI-generated — verify.',
    sql: `-- Genie is not connected in the local MVP
SELECT interaction_id, queue, duration_seconds
FROM interactions
LIMIT 5`,
    columns: ['interaction_id', 'queue', 'duration'],
    rows: INTERACTIONS.slice(0, 5).map((c) => ({
      cells: [c.id, c.queue, `${c.durationSeconds}s`],
      href: `#/calls/${c.id}`,
    })),
  }
}

export function interactionById(id: string) {
  return INTERACTIONS.find((c) => c.id === id)
}

export function themeById(id: string) {
  return THEMES.find((t) => t.id === id)
}
