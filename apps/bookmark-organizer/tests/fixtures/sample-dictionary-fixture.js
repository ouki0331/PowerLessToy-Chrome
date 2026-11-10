/**
 * TEST FIXTURE ONLY (tests/fixtures/sample-dictionary-fixture.js)
 *
 * Minimal mock sample dictionary data used exclusively for unit testing
 * storage operations, rollback behaviors, and search logic without requiring
 * multi-megabyte official dictionary files in test suites.
 *
 * DO NOT USE FOR PRODUCTION BUILDS.
 * Official production packs are built exclusively from official upstream archives
 * via scripts/build-dictionary-packs.js.
 */

export const SAMPLE_JA_ENTRIES = [
  { id: "ja_0001", word: "日本", reading: "にほん", pos: ["n"], senses: [{ glosses: ["Japan"], misc: [] }], common: true },
  { id: "ja_0002", word: "日本語", reading: "にほんご", pos: ["n"], senses: [{ glosses: ["Japanese language"], misc: [] }], common: true },
  { id: "ja_0003", word: "辞書", reading: "じしょ", pos: ["n"], senses: [{ glosses: ["dictionary", "lexicon"], misc: [] }], common: true },
  { id: "ja_0004", word: "本", reading: "ほん", pos: ["n"], senses: [{ glosses: ["book", "volume", "script"], misc: [] }], common: true },
  { id: "ja_0005", word: "読書", reading: "どくしょ", pos: ["n", "vs"], senses: [{ glosses: ["reading books"], misc: [] }], common: true },
  { id: "ja_0006", word: "検索", reading: "けんさく", pos: ["n", "vs"], senses: [{ glosses: ["search", "lookup", "retrieval"], misc: [] }], common: true },
  { id: "ja_0007", word: "道具", reading: "どうぐ", pos: ["n"], senses: [{ glosses: ["tool", "implement", "instrument"], misc: [] }], common: true },
  { id: "ja_0008", word: "設定", reading: "せってい", pos: ["n", "vs"], senses: [{ glosses: ["settings", "configuration", "setup"], misc: [] }], common: true },
  { id: "ja_0009", word: "科学", reading: "かがく", pos: ["n"], senses: [{ glosses: ["science"], misc: [] }], common: true },
  { id: "ja_0010", word: "開発", reading: "かいはつ", pos: ["n", "vs"], senses: [{ glosses: ["development", "exploitation"], misc: [] }], common: true },
  { id: "ja_0011", word: "自然", reading: "しぜん", pos: ["n", "adj-na"], senses: [{ glosses: ["nature", "spontaneous", "natural"], misc: [] }], common: true },
  { id: "ja_0012", word: "桜", reading: "さくら", pos: ["n"], senses: [{ glosses: ["cherry blossom", "cherry tree (Prunus serrulata)"], misc: [] }], common: true },
  { id: "ja_0013", word: "勉強", reading: "べんきょう", pos: ["n", "vs"], senses: [{ glosses: ["study", "diligence"], misc: [] }], common: true },
  { id: "ja_0014", word: "自由", reading: "じゆう", pos: ["adj-na", "n"], senses: [{ glosses: ["freedom", "liberty", "as you please"], misc: [] }], common: true },
  { id: "ja_0015", word: "時間", reading: "じかん", pos: ["n"], senses: [{ glosses: ["time", "hours", "duration"], misc: [] }], common: true },
  { id: "ja_0016", word: "未来", reading: "みらい", pos: ["n"], senses: [{ glosses: ["future (usually distant)", "future tense"], misc: [] }], common: true },
  { id: "ja_0017", word: "記録", reading: "きろく", pos: ["n", "vs"], senses: [{ glosses: ["record", "minutes", "document"], misc: [] }], common: true },
  { id: "ja_0018", word: "友達", reading: "ともだち", pos: ["n"], senses: [{ glosses: ["friend", "companion"], misc: [] }], common: true },
  { id: "ja_0019", word: "家族", reading: "かぞく", pos: ["n"], senses: [{ glosses: ["family", "members of a family"], misc: [] }], common: true },
  { id: "ja_0020", word: "言葉", reading: "ことば", pos: ["n"], senses: [{ glosses: ["language", "dialect", "word", "phrase"], misc: [] }], common: true },
  { id: "ja_0021", word: "意味", reading: "いみ", pos: ["n", "vs"], senses: [{ glosses: ["meaning", "significance", "sense"], misc: [] }], common: true },
  { id: "ja_0022", word: "翻訳", reading: "ほんやく", pos: ["n", "vs"], senses: [{ glosses: ["translation", "de-ciphering"], misc: [] }], common: true },
  { id: "ja_0023", word: "質問", reading: "しつもん", pos: ["n", "vs"], senses: [{ glosses: ["question", "inquiry"], misc: [] }], common: true },
  { id: "ja_0024", word: "回答", reading: "かいとう", pos: ["n", "vs"], senses: [{ glosses: ["answer", "reply", "response"], misc: [] }], common: true },
  { id: "ja_0025", word: "世界", reading: "せかい", pos: ["n"], senses: [{ glosses: ["world", "society", "universe"], misc: [] }], common: true },
  { id: "ja_0026", word: "学校", reading: "がっこう", pos: ["n"], senses: [{ glosses: ["school"], misc: [] }], common: true },
  { id: "ja_0027", word: "会社", reading: "かいしゃ", pos: ["n"], senses: [{ glosses: ["company", "corporation", "workplace"], misc: [] }], common: true },
  { id: "ja_0028", word: "生活", reading: "せいかつ", pos: ["n", "vs"], senses: [{ glosses: ["living", "life (one's daily existence)", "livelihood"], misc: [] }], common: true },
  { id: "ja_0029", word: "水", reading: "みず", pos: ["n"], senses: [{ glosses: ["water (especially cool or fresh water)"], misc: [] }], common: true },
  { id: "ja_0030", word: "火", reading: "ひ", pos: ["n"], senses: [{ glosses: ["fire", "flame", "blaze"], misc: [] }], common: true },
  { id: "ja_0031", word: "木", reading: "き", pos: ["n"], senses: [{ glosses: ["tree", "shrub", "wood", "timber"], misc: [] }], common: true },
  { id: "ja_0032", word: "金", reading: "きん", pos: ["n"], senses: [{ glosses: ["gold", "money", "Friday"], misc: [] }], common: true },
  { id: "ja_0033", word: "土", reading: "つち", pos: ["n"], senses: [{ glosses: ["earth", "soil", "dirt", "ground"], misc: [] }], common: true },
  { id: "ja_0034", word: "日", reading: "ひ", pos: ["n"], senses: [{ glosses: ["day", "days", "sun", "sunshine"], misc: [] }], common: true },
  { id: "ja_0035", word: "月", reading: "つき", pos: ["n"], senses: [{ glosses: ["moon", "month"], misc: [] }], common: true },
  { id: "ja_0036", word: "新しい", reading: "あたらしい", pos: ["adj-i"], senses: [{ glosses: ["new", "novel", "fresh", "recent"], misc: [] }], common: true },
  { id: "ja_0037", word: "良い", reading: "よい", pos: ["adj-i"], senses: [{ glosses: ["good", "excellent", "fine", "nice"], misc: [] }], common: true },
  { id: "ja_0038", word: "大きい", reading: "おおきい", pos: ["adj-i"], senses: [{ glosses: ["big", "large", "great"], misc: [] }], common: true },
  { id: "ja_0039", word: "小さい", reading: "ちいさい", pos: ["adj-i"], senses: [{ glosses: ["small", "little", "tiny"], misc: [] }], common: true },
  { id: "ja_0040", word: "行く", reading: "いく", pos: ["v5k"], senses: [{ glosses: ["to go", "to move towards", "to head towards"], misc: [] }], common: true },
  { id: "ja_0041", word: "来る", reading: "くる", pos: ["vk"], senses: [{ glosses: ["to come", "to arrive", "to approach"], misc: [] }], common: true },
  { id: "ja_0042", word: "食べる", reading: "たべる", pos: ["v1"], senses: [{ glosses: ["to eat"], misc: [] }], common: true },
  { id: "ja_0043", word: "飲む", reading: "のむ", pos: ["v5m"], senses: [{ glosses: ["to drink", "to swallow", "to take (medicine)"], misc: [] }], common: true },
  { id: "ja_0044", word: "見る", reading: "みる", pos: ["v1"], senses: [{ glosses: ["to see", "to look", "to watch", "to view"], misc: [] }], common: true },
  { id: "ja_0045", word: "聞く", reading: "きく", pos: ["v5k"], senses: [{ glosses: ["to hear", "to listen", "to ask", "to enquire"], misc: [] }], common: true },
  { id: "ja_0046", word: "話す", reading: "はなす", pos: ["v5s"], senses: [{ glosses: ["to speak", "to talk", "to converse"], misc: [] }], common: true },
  { id: "ja_0047", word: "書く", reading: "かく", pos: ["v5k"], senses: [{ glosses: ["to write", "to compose", "to draw"], misc: [] }], common: true },
  { id: "ja_0048", word: "読む", reading: "よむ", pos: ["v5m"], senses: [{ glosses: ["to read", "to recite", "to understand"], misc: [] }], common: true },
  { id: "ja_0049", word: "する", reading: "する", pos: ["vs-i"], senses: [{ glosses: ["to do", "to perform", "to carry out"], misc: [] }], common: true },
  { id: "ja_0050", word: "ある", reading: "ある", pos: ["v5r-i"], senses: [{ glosses: ["to be", "to exist (inanimate objects)", "to have"], misc: [] }], common: true },
  { id: "ja_0051", word: "いる", reading: "いる", pos: ["v1"], senses: [{ glosses: ["to be", "to exist (animate beings)", "to stay"], misc: [] }], common: true },
  { id: "ja_0052", word: "ありがとう", reading: "ありがとう", pos: ["int"], senses: [{ glosses: ["thank you", "thanks"], misc: [] }], common: true },
  { id: "ja_0053", word: "こんにちは", reading: "こんにちは", pos: ["int"], senses: [{ glosses: ["hello", "good afternoon"], misc: [] }], common: true },
  { id: "ja_0054", word: "さようなら", reading: "さようなら", pos: ["int"], senses: [{ glosses: ["goodbye", "farewell"], misc: [] }], common: true },
  { id: "ja_0055", word: "静か", reading: "しずか", pos: ["adj-na", "n"], senses: [{ glosses: ["quiet", "silent", "calm", "peaceful"], misc: [] }], common: true },
  { id: "ja_0056", word: "美しい", reading: "うつくしい", pos: ["adj-i"], senses: [{ glosses: ["beautiful", "lovely", "pure"], misc: [] }], common: true },
  { id: "ja_0057", word: "簡単", reading: "かんたん", pos: ["adj-na", "n"], senses: [{ glosses: ["simple", "easy", "brief", "quick"], misc: [] }], common: true },
  { id: "ja_0058", word: "便利", reading: "べんり", pos: ["adj-na", "n"], senses: [{ glosses: ["convenient", "handy", "useful"], misc: [] }], common: true },
  { id: "ja_0059", word: "重要", reading: "じゅうよう", pos: ["adj-na", "n"], senses: [{ glosses: ["important", "momentous", "essential"], misc: [] }], common: true },
  { id: "ja_0060", word: "安全", reading: "あんぜん", pos: ["adj-na", "n"], senses: [{ glosses: ["safety", "security", "safe"], misc: [] }], common: true },
  { id: "ja_0061", word: "平和", reading: "へいわ", pos: ["adj-na", "n"], senses: [{ glosses: ["peace", "harmony"], misc: [] }], common: true },
  { id: "ja_0062", word: "希望", reading: "きぼう", pos: ["n", "vs"], senses: [{ glosses: ["hope", "wish", "aspiration"], misc: [] }], common: true },
  { id: "ja_0063", word: "感謝", reading: "かんしゃ", pos: ["n", "vs"], senses: [{ glosses: ["gratitude", "thanks", "appreciation"], misc: [] }], common: true },
  { id: "ja_0064", word: "情報", reading: "じょうほう", pos: ["n"], senses: [{ glosses: ["information", "news", "intelligence"], misc: [] }], common: true },
  { id: "ja_0065", word: "環境", reading: "かんきょう", pos: ["n"], senses: [{ glosses: ["environment", "circumstance"], misc: [] }], common: true }
];

const enEntries = [
  {
    id: "en_0001",
    word: "bookmark",
    pos: ["noun", "verb"],
    senses: [
      {
        definition: "a marker (as of ribbon, leather, or paper) inserted between pages of a book",
        synonyms: ["marker", "bookmarker"],
        examples: ["She slipped a ribbon bookmark into the page."]
      },
      {
        definition: "a record of the address of a file or webpage on the internet, enabling quick access",
        synonyms: ["favorite", "URL bookmark"],
        examples: ["He added the documentation link to his browser bookmarks."]
      },
      {
        definition: "record the address of a website, file, or page to enable quick access in future",
        synonyms: [],
        examples: ["Don't forget to bookmark this useful repository."]
      }
    ]
  },
  {
    id: "en_0002",
    word: "dictionary",
    pos: ["noun"],
    senses: [
      {
        definition: "a reference book or online resource containing an alphabetical list of words, with information given for each word including meaning, pronunciation, etymology, and usage",
        synonyms: ["lexicon", "glossary", "vocabulary"],
        examples: ["I looked up the rare term in the unabridged dictionary."]
      }
    ]
  },
  {
    id: "en_0003",
    word: "workbench",
    pos: ["noun"],
    senses: [
      {
        definition: "a sturdy table at which manual work or software development is done",
        synonyms: ["worktable", "work surface"],
        examples: ["The engineer kept all key environment tools arranged neatly on the workbench."]
      }
    ]
  },
  {
    id: "en_0004",
    word: "organizer",
    pos: ["noun"],
    senses: [
      {
        definition: "a person or item that organizes things, files, or information efficiently",
        synonyms: ["coordinator", "arranger"],
        examples: ["Bookmark Organizer keeps your projects organized across workspaces."]
      }
    ]
  },
  {
    id: "en_0005",
    word: "search",
    pos: ["verb", "noun"],
    senses: [
      {
        definition: "try to find something by looking or otherwise seeking carefully and thoroughly",
        synonyms: ["seek", "hunt", "explore"],
        examples: ["Use Spotlight search to instantly locate environments and documentation."]
      },
      {
        definition: "an act of searching for someone or something",
        synonyms: ["hunt", "inquiry", "quest"],
        examples: ["The quick search returned exact results across all active categories."]
      }
    ]
  },
  {
    id: "en_0006",
    word: "language",
    pos: ["noun"],
    senses: [
      {
        definition: "the principal method of human communication, consisting of words used in a structured and conventional way",
        synonyms: ["tongue", "speech", "dialect"],
        examples: ["The dictionary module supports multiple languages including Japanese and English."]
      }
    ]
  },
  {
    id: "en_0007",
    word: "computer",
    pos: ["noun"],
    senses: [
      {
        definition: "an electronic device for storing and processing data, typically in binary form",
        synonyms: ["processor", "computing device"],
        examples: ["The application operates entirely locally on your personal computer."]
      }
    ]
  },
  {
    id: "en_0008",
    word: "software",
    pos: ["noun"],
    senses: [
      {
        definition: "the programs and other operating information used by a computer",
        synonyms: ["programs", "applications", "code"],
        examples: ["Reliable open source software respects user privacy and data ownership."]
      }
    ]
  },
  {
    id: "en_0009",
    word: "network",
    pos: ["noun", "verb"],
    senses: [
      {
        definition: "a group or system of interconnected people or things, or connected computers",
        synonyms: ["web", "system", "grid"],
        examples: ["The offline dictionary requires zero network connection once installed."]
      }
    ]
  },
  {
    id: "en_0010",
    word: "environment",
    pos: ["noun"],
    senses: [
      {
        definition: "the surroundings or conditions in which a person, animal, or plant lives, or the software context (DEV, TEST, PROD)",
        synonyms: ["habitat", "milieu", "setting"],
        examples: ["Switch seamlessly between DEV, TEST, and PROD portals."]
      }
    ]
  },
  {
    id: "en_0011",
    word: "browser",
    pos: ["noun"],
    senses: [
      {
        definition: "a computer program with a graphical user interface for displaying and navigating between web pages",
        synonyms: ["web browser"],
        examples: ["The extension works across Chrome, Firefox, and Chromium-based browsers."]
      }
    ]
  },
  {
    id: "en_0012",
    word: "knowledge",
    pos: ["noun"],
    senses: [
      {
        definition: "facts, information, and skills acquired by a person through experience or education",
        synonyms: ["understanding", "wisdom", "insight"],
        examples: ["The dictionary provides verified linguistic knowledge."]
      }
    ]
  },
  {
    id: "en_0013",
    word: "science",
    pos: ["noun"],
    senses: [
      {
        definition: "the systematic study of the structure and behavior of the physical and natural world through observation and experiment",
        synonyms: ["empirical inquiry"],
        examples: ["Computer science principles guide efficient indexing algorithms."]
      }
    ]
  },
  {
    id: "en_0014",
    word: "quiet",
    pos: ["adjective", "noun"],
    senses: [
      {
        definition: "making little or no noise; peaceful, unobtrusive",
        synonyms: ["silent", "calm", "serene", "unobtrusive"],
        examples: ["A quiet digital workbench avoids noisy notifications and unwanted popups."]
      }
    ]
  },
  {
    id: "en_0015",
    word: "privacy",
    pos: ["noun"],
    senses: [
      {
        definition: "the state or condition of being free from being observed or disturbed by other people, tracking, or telemetry",
        synonyms: ["seclusion", "confidentiality"],
        examples: ["Zero tracking and strictly local storage guarantee complete user privacy."]
      }
    ]
  },
  {
    id: "en_0016",
    word: "word",
    pos: ["noun"],
    senses: [
      {
        definition: "a single distinct meaningful element of speech or writing, used with others to form a sentence",
        synonyms: ["term", "expression", "lexeme"],
        examples: ["Look up any unfamiliar word in the built-in offline dictionary."]
      }
    ]
  },
  {
    id: "en_0017",
    word: "meaning",
    pos: ["noun"],
    senses: [
      {
        definition: "what is meant by a word, text, concept, or action",
        synonyms: ["significance", "sense", "definition"],
        examples: ["The dictionary explains the subtle meaning of each sense."]
      }
    ]
  },
  {
    id: "en_0018",
    word: "context",
    pos: ["noun"],
    senses: [
      {
        definition: "the circumstances that form the setting for an event, statement, or idea, and in terms of which it can be fully understood",
        synonyms: ["surroundings", "background", "framework"],
        examples: ["AI explains the exact nuance of the word within the context of the sentence."]
      }
    ]
  },
  {
    id: "en_0019",
    word: "freedom",
    pos: ["noun"],
    senses: [
      {
        definition: "the power or right to act, speak, or think as one wants without hindrance or restraint",
        synonyms: ["liberty", "independence", "autonomy"],
        examples: ["Open source software grants users the freedom to inspect and control their tools."]
      }
    ]
  },
  {
    id: "en_0020",
    word: "peace",
    pos: ["noun"],
    senses: [
      {
        definition: "freedom from disturbance; tranquility, serenity, harmony",
        synonyms: ["calm", "tranquility", "serenity"],
        examples: ["A calm interface brings peace of mind to daily web browsing."]
      }
    ]
  }
];

export const SAMPLE_JA_PACK = {
  packId: "ja_jmdict",
  language: "ja",
  name: "JMdict (Test Sample)",
  version: "1.0.0-sample",
  source: "Electronic Dictionary Research and Development Group (EDRDG)",
  sourceUrl: "https://ftp.edrdg.org/pub/Nihongo/00INDEX.html",
  license: "CC BY-SA 4.0",
  attribution: "Test sample fixture.",
  entries: SAMPLE_JA_ENTRIES
};

export const SAMPLE_EN_PACK = {
  packId: "en_wordnet",
  language: "en",
  name: "Open English WordNet (Test Sample)",
  version: "1.0.0-sample",
  source: "Global WordNet Association / Open English WordNet",
  sourceUrl: "https://en-word.net/",
  license: "CC BY 4.0",
  attribution: "Test sample fixture.",
  entries: enEntries
};

export const SAMPLE_EN_ENTRIES = enEntries;
