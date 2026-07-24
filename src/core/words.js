// Word banks by difficulty. Pure data — shared by web and terminal.
// `easy`   : short, extremely common words (fast to type, low finger travel)
// `medium` : the classic 200 most-common English words
// `hard`   : longer, less common, more awkward letter combinations

export const WORD_BANKS = {
  easy: [
    'the', 'and', 'you', 'that', 'was', 'for', 'are', 'with', 'his', 'they',
    'this', 'have', 'from', 'one', 'had', 'word', 'but', 'not', 'what', 'all',
    'were', 'when', 'your', 'can', 'said', 'there', 'use', 'each', 'she', 'how',
    'their', 'will', 'other', 'about', 'out', 'many', 'then', 'them', 'these',
    'some', 'her', 'would', 'make', 'like', 'him', 'into', 'time', 'has', 'look',
    'two', 'more', 'day', 'did', 'get', 'come', 'made', 'may', 'part', 'over',
    'new', 'sound', 'take', 'only', 'little', 'work', 'know', 'place', 'year',
    'live', 'back', 'give', 'most', 'very', 'good', 'man', 'think', 'say', 'help',
  ],
  medium: [
    'people', 'because', 'through', 'between', 'another', 'around', 'important',
    'children', 'different', 'together', 'thought', 'always', 'something',
    'question', 'example', 'business', 'without', 'against', 'nothing',
    'everyone', 'sometimes', 'change', 'family', 'friend', 'system', 'program',
    'problem', 'company', 'number', 'group', 'follow', 'begin', 'water',
    'science', 'country', 'weather', 'measure', 'increase', 'decision',
    'remember', 'consider', 'continue', 'possible', 'position', 'complete',
    'develop', 'general', 'special', 'natural', 'certain', 'perhaps', 'himself',
    'kitchen', 'evening', 'morning', 'history', 'picture', 'machine',
    'account', 'freedom', 'journey', 'library', 'quality', 'purpose', 'section',
    'similar', 'station', 'teacher', 'village', 'welcome', 'balance', 'capital',
  ],
  hard: [
    'rhythm', 'awkward', 'juxtapose', 'bureaucracy', 'conscientious',
    'unequivocally', 'quintessential', 'onomatopoeia', 'kaleidoscope',
    'labyrinthine', 'idiosyncratic', 'perpendicular', 'entrepreneurship',
    'exquisite', 'sphinx', 'zephyr', 'gnarly', 'psychology', 'mnemonic',
    'phlegm', 'squawk', 'jinx', 'fjord', 'lymph', 'crypt', 'glyph', 'wryly',
    'syzygy', 'twelfth', 'strengths', 'sixths', 'nymphs', 'schnapps',
    'asymmetric', 'buoyancy', 'catastrophe', 'dexterity', 'euphemism',
    'flabbergasted', 'gregarious', 'hierarchy', 'inconceivable', 'jubilant',
    'knowledgeable', 'lieutenant', 'malfeasance', 'nonchalant', 'obfuscate',
    'paradoxical', 'quizzical', 'reverberate', 'serendipity', 'tumultuous',
    'ubiquitous', 'vicissitude', 'whimsical', 'xylophone', 'yacht', 'zealous',
  ],
};

// Common punctuation-ish symbols used by the "punctuation" mode to sprinkle
// realistic marks between words.
export const PUNCTUATION = [',', '.', '.', '.', ';', ':', '?', '!', '—'];
