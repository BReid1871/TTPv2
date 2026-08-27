// Static sample AnalysisReport data for demo.html — lets you preview the
// dashboard layout without a live Showdown connection.

const demoRooms = [
  { roomid: 'battle-gen9randombattle-1', title: 'vs. Guest 1029884' },
  { roomid: 'battle-gen9randombattle-2', title: 'vs. Guest 4471002' },
];

const demoReports = new Map();

demoReports.set('battle-gen9randombattle-1', {
  roomid: 'battle-gen9randombattle-1',
  turn: 8,
  generatedAt: Date.now(),
  format: '[Gen 9] Random Battle',
  waiting: false,
  active: {
    yours: { ident: 'p1a: Kingambit', species: 'Kingambit', hpPercent: 100, status: undefined, fainted: false, isActive: true },
    opponent: {
      ident: 'p2a: Great Tusk', species: 'Great Tusk', level: 84, hpPercent: 62, status: 'par', fainted: false, isActive: true,
      dataFound: true,
      candidateRoles: ['Bulky Support', 'Physical Attacker'],
      ability: { known: 'Protosynthesis', possible: [] },
      item: { possible: [
        { name: 'Leftovers', probability: 0.4 },
        { name: 'Heavy-Duty Boots', probability: 0.35 },
        { name: 'Booster Energy', probability: 0.25 },
      ] },
      teraType: { possible: [
        { name: 'Fire', probability: 0.3 },
        { name: 'Water', probability: 0.25 },
        { name: 'Steel', probability: 0.2 },
        { name: 'Flying', probability: 0.15 },
      ] },
      revealedMoves: ['Rapid Spin', 'Headlong Rush'],
      possibleRemainingMoves: [
        { name: 'Close Combat', probability: 0.55 },
        { name: 'Ice Spinner', probability: 0.3 },
        { name: 'Stealth Rock', probability: 0.2 },
      ],
    },
    yourMovesVsOpponent: [
      { name: 'Kowtow Cleave', minPercent: 45, maxPercent: 53, mostLikelyPercent: 49, koChance: undefined, confirmed: true },
      { name: 'Iron Head', minPercent: 30, maxPercent: 36, mostLikelyPercent: 33, koChance: undefined, confirmed: true },
      { name: 'Sucker Punch', minPercent: 20, maxPercent: 24, mostLikelyPercent: 22, koChance: undefined, confirmed: true },
    ],
    opponentMovesVsYou: [
      { name: 'Headlong Rush', minPercent: 55, maxPercent: 65, mostLikelyPercent: 60, koChance: 'guaranteed 2HKO', confirmed: true },
      { name: 'Close Combat', minPercent: 48, maxPercent: 57, mostLikelyPercent: 52, koChance: 'possible 2HKO', confirmed: false, probability: 0.55 },
      { name: 'Ice Spinner', minPercent: 15, maxPercent: 18, mostLikelyPercent: 16, koChance: undefined, confirmed: false, probability: 0.3 },
    ],
    speed: {
      yourSpeed: 178,
      opponentSpeedRange: [67, 91],
      opponentSpeedMostLikely: 78,
      youAreFasterWorstCase: true,
      youAreFasterBestCase: true,
      youAreFasterMostLikely: true,
      trickRoomActive: false,
    },
  },
  bench: [
    {
      yours: { ident: 'p1b: Iron Valiant', species: 'Iron Valiant', hpPercent: 100, status: undefined, fainted: false, isActive: false },
      opponent: {
        ident: 'p2a: Great Tusk', species: 'Great Tusk', level: 84, hpPercent: 62, status: 'par', fainted: false, isActive: true,
        dataFound: true,
        candidateRoles: ['Bulky Support', 'Physical Attacker'],
        ability: { known: 'Protosynthesis', possible: [] },
        item: { possible: [
          { name: 'Leftovers', probability: 0.4 },
          { name: 'Heavy-Duty Boots', probability: 0.35 },
          { name: 'Booster Energy', probability: 0.25 },
        ] },
        teraType: { possible: [
          { name: 'Fire', probability: 0.3 },
          { name: 'Water', probability: 0.25 },
          { name: 'Steel', probability: 0.2 },
        ] },
        revealedMoves: ['Rapid Spin', 'Headlong Rush'],
        possibleRemainingMoves: [
          { name: 'Close Combat', probability: 0.55 },
          { name: 'Ice Spinner', probability: 0.3 },
        ],
      },
      yourMovesVsOpponent: [
        { name: 'Moonblast', minPercent: 38, maxPercent: 45, mostLikelyPercent: 41, koChance: undefined, confirmed: true },
        { name: 'Psychic', minPercent: 22, maxPercent: 27, mostLikelyPercent: 24, koChance: undefined, confirmed: true },
      ],
      opponentMovesVsYou: [
        { name: 'Headlong Rush', minPercent: 60, maxPercent: 71, mostLikelyPercent: 65, koChance: 'possible 2HKO', confirmed: true },
      ],
      speed: {
        yourSpeed: 195,
        opponentSpeedRange: [67, 91],
        opponentSpeedMostLikely: 78,
        youAreFasterWorstCase: true,
        youAreFasterBestCase: true,
        youAreFasterMostLikely: true,
        trickRoomActive: false,
      },
    },
    {
      yours: { ident: 'p1c: Dragapult', species: 'Dragapult', hpPercent: 88, status: undefined, fainted: false, isActive: false },
      opponent: {
        ident: 'p2a: Great Tusk', species: 'Great Tusk', level: 84, hpPercent: 62, status: 'par', fainted: false, isActive: true,
        dataFound: true,
        candidateRoles: ['Bulky Support', 'Physical Attacker'],
        ability: { known: 'Protosynthesis', possible: [] },
        item: { possible: [
          { name: 'Leftovers', probability: 0.4 },
          { name: 'Heavy-Duty Boots', probability: 0.35 },
        ] },
        teraType: { possible: [{ name: 'Fire', probability: 0.3 }] },
        revealedMoves: ['Rapid Spin', 'Headlong Rush'],
        possibleRemainingMoves: [{ name: 'Close Combat', probability: 0.55 }],
      },
      yourMovesVsOpponent: [
        { name: 'Draco Meteor', minPercent: 50, maxPercent: 59, mostLikelyPercent: 55, koChance: 'possible 2HKO', confirmed: true },
        { name: 'Shadow Ball', minPercent: 18, maxPercent: 22, mostLikelyPercent: 20, koChance: undefined, confirmed: true },
      ],
      opponentMovesVsYou: [
        { name: 'Headlong Rush', minPercent: 40, maxPercent: 48, mostLikelyPercent: 44, koChance: undefined, confirmed: true },
      ],
      speed: {
        yourSpeed: 213,
        opponentSpeedRange: [67, 91],
        opponentSpeedMostLikely: 78,
        youAreFasterWorstCase: true,
        youAreFasterBestCase: true,
        youAreFasterMostLikely: true,
        trickRoomActive: false,
      },
    },
  ],
  opponentRevealedBench: [
    {
      ident: 'p2b: Iron Hands', species: 'Iron Hands', level: 82, hpPercent: 100, status: undefined, fainted: false, isActive: false,
      dataFound: true,
      candidateRoles: ['Bulky Attacker'],
      ability: { known: 'Quark Drive', possible: [] },
      item: { possible: [
        { name: 'Assault Vest', probability: 0.5 },
        { name: 'Leftovers', probability: 0.3 },
        { name: 'Booster Energy', probability: 0.2 },
      ] },
      teraType: { possible: [{ name: 'Water', probability: 0.4 }, { name: 'Grass', probability: 0.3 }] },
      revealedMoves: ['Drain Punch', 'Wild Charge'],
      possibleRemainingMoves: [
        { name: 'Ice Punch', probability: 0.4 },
        { name: 'Fake Out', probability: 0.35 },
      ],
    },
  ],
});

demoReports.set('battle-gen9randombattle-2', {
  roomid: 'battle-gen9randombattle-2',
  turn: 1,
  generatedAt: Date.now(),
  format: '[Gen 9] Random Battle',
  waiting: true,
  waitingReason: 'Waiting to confirm which side is yours...',
  bench: [],
  opponentRevealedBench: [],
});
