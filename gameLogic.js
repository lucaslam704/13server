// Thirteen (Tien Len) Game Logic for Server
// Simplified version with only functions needed for server-side operations

// Card ranking system
const RANK_ORDER = {
  '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8,
  'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13
};

const SUIT_ORDER = {
  '♠': 1, // Spades (lowest)
  '♣': 2, // Clubs
  '♦': 3, // Diamonds
  '♥': 4  // Hearts (highest)
};

// Parse card into rank and suit
function parseCard(card) {
  const rank = card.slice(0, -1);
  const suit = card.slice(-1);
  return {
    rank,
    suit,
    rankValue: RANK_ORDER[rank],
    suitValue: SUIT_ORDER[suit]
  };
}

// Compare two cards
function compareCards(card1, card2) {
  const c1 = parseCard(card1);
  const c2 = parseCard(card2);

  // First compare by rank
  if (c1.rankValue !== c2.rankValue) {
    return c1.rankValue - c2.rankValue;
  }

  // If ranks are equal, compare by suit
  return c1.suitValue - c2.suitValue;
}

// Sort cards by rank and suit
function sortCards(cards) {
  return [...cards].sort(compareCards);
}

// Validate combination
function validateCombination(cards) {
  if (!cards || cards.length === 0) return null;

  const sortedCards = sortCards(cards);
  const parsedCards = sortedCards.map(parseCard);

  // Single card
  if (cards.length === 1) {
    const card = parsedCards[0];
    return {
      type: 'single',
      cards: sortedCards,
      rank: card.rankValue * 10 + card.suitValue,
      length: 1
    };
  }

  // Pair
  if (cards.length === 2 && parsedCards[0].rankValue === parsedCards[1].rankValue) {
    const card = parsedCards[0];
    return {
      type: 'pair',
      cards: sortedCards,
      rank: card.rankValue * 10 + Math.max(card.suitValue, parsedCards[1].suitValue),
      length: 2
    };
  }

  // Triple
  if (cards.length === 3 && parsedCards[0].rankValue === parsedCards[1].rankValue &&
      parsedCards[1].rankValue === parsedCards[2].rankValue) {
    const card = parsedCards[0];
    return {
      type: 'triple',
      cards: sortedCards,
      rank: card.rankValue * 10 + Math.max(...parsedCards.map(c => c.suitValue)),
      length: 3
    };
  }

  // Quad
  if (cards.length === 4 && parsedCards.every(c => c.rankValue === parsedCards[0].rankValue)) {
    const card = parsedCards[0];
    return {
      type: 'quad',
      cards: sortedCards,
      rank: card.rankValue * 10 + Math.max(...parsedCards.map(c => c.suitValue)),
      length: 4
    };
  }

  // Four of a kind
  if (cards.length === 4) {
    const rankGroups = {};
    sortedCards.forEach((card, index) => {
      const parsed = parsedCards[index];
      if (!rankGroups[parsed.rankValue]) {
        rankGroups[parsed.rankValue] = [];
      }
      rankGroups[parsed.rankValue].push(card);
    });

    // Check if any rank has exactly 4 cards
    for (const rank in rankGroups) {
      if (rankGroups[rank].length === 4) {
        const rankValue = parseInt(rank);
        return {
          type: 'four_of_kind',
          cards: sortedCards,
          rank: rankValue * 10 + 3,
          length: 4,
          power: 2
        };
      }
    }
  }

  // Three pairs
  if (cards.length === 6) {
    const pairs = getPairsFromCardsGL(sortedCards, parsedCards);
    if (pairs.length === 3) {
      const pairRanks = pairs.map(p => p.rank).sort((a, b) => a - b);
      const isContinuous = pairRanks.every((rank, index) => {
        if (index === 0) return true;
        return rank === pairRanks[index - 1] + 1;
      });

      if (isContinuous) {
        const highestRank = pairRanks[pairRanks.length - 1];
        return {
          type: 'three_pairs',
          cards: sortedCards,
          rank: highestRank * 10 + 1,
          length: 3,
          power: 1
        };
      }
    }
  }

  // Four pairs
  if (cards.length === 8) {
    const pairs = getPairsFromCardsGL(sortedCards, parsedCards);
    if (pairs.length === 4) {
      const pairRanks = pairs.map(p => p.rank).sort((a, b) => a - b);
      const isContinuous = pairRanks.every((rank, index) => {
        if (index === 0) return true;
        return rank === pairRanks[index - 1] + 1;
      });

      if (isContinuous) {
        const highestRank = pairRanks[pairRanks.length - 1];
        return {
          type: 'four_pairs',
          cards: sortedCards,
          rank: highestRank * 10 + 2,
          length: 4,
          power: 3
        };
      }
    }
  }

  // Straight (3+ consecutive cards, NO 2s allowed)
  if (cards.length >= 3) {
    // Check for 2s - straights cannot contain 2s
    if (parsedCards.some(card => card.rankValue === 13)) { // 13 is the value for '2'
      return null; // Invalid straight - contains 2
    }

    const isStraight = parsedCards.every((card, index) => {
      if (index === 0) return true;
      return card.rankValue === parsedCards[index - 1].rankValue + 1;
    });

    if (isStraight) {
      // For straights, use the highest card's rank and suit for comparison
      const highestCard = parsedCards[parsedCards.length - 1];
      return {
        type: 'straight',
        cards: sortedCards,
        rank: highestCard.rankValue * 10 + highestCard.suitValue,
        length: cards.length
      };
    }
  }

  return null;
}

// Helper function to extract pairs from cards
function getPairsFromCardsGL(sortedCards, parsedCards) {
  const rankGroups = {};

  sortedCards.forEach((card, index) => {
    const parsed = parsedCards[index];
    if (!rankGroups[parsed.rankValue]) {
      rankGroups[parsed.rankValue] = [];
    }
    rankGroups[parsed.rankValue].push(card);
  });

  const pairs = [];
  for (const rank in rankGroups) {
    if (rankGroups[rank].length === 2) {
      pairs.push({
        rank: parseInt(rank),
        cards: rankGroups[rank]
      });
    }
  }

  return pairs;
}

// Check if combination can beat another
function canBeatCombination(newCombo, currentCombo) {
  // If no current combination, any valid combination can start
  if (!currentCombo) return true;

  // Special case: Check if current combo is a single 2
  const isCurrentTwo = currentCombo.type === 'single' && parseCard(currentCombo.cards[0]).rankValue === 13;

  // Special combinations can beat 2s
  if (isCurrentTwo) {
    // 3 pairs can beat 1 card number 2
    if (newCombo.type === 'three_pairs') {
      return true;
    }
    // 4 pairs can beat up to 2 card number 2
    if (newCombo.type === 'four_pairs') {
      return currentCombo.cards.length <= 2;
    }
    // Four of a kind can beat up to 2 card number 2
    if (newCombo.type === 'four_of_kind') {
      return currentCombo.cards.length <= 2;
    }
    // Original bombs still work
    if (newCombo.type === 'quad') {
      return true;
    }
  }

  // Must be same type (unless it's a special combination beating 2s)
  if (newCombo.type !== currentCombo.type) {
    // Allow special combinations to beat regular combinations of same type
    if (isSpecialCombination(newCombo.type) && isSpecialCombination(currentCombo.type)) {
      return compareSpecialCombinations(newCombo, currentCombo);
    }
    return false;
  }

  // For straights, must have same length
  if (newCombo.type === 'straight' && newCombo.length !== currentCombo.length) {
    return false;
  }

  // Compare ranks for same type combinations
  return newCombo.rank > currentCombo.rank;
}

// Check if combination type is a special combination
function isSpecialCombination(type) {
  return ['three_pairs', 'four_pairs', 'four_of_kind'].includes(type);
}

// Compare special combinations (4 pairs > Four of a kind > 3 pairs)
function compareSpecialCombinations(newCombo, currentCombo) {
  const powerOrder = {
    'three_pairs': 1,
    'four_of_kind': 2,
    'four_pairs': 3
  };

  const newPower = powerOrder[newCombo.type] || 0;
  const currentPower = powerOrder[currentCombo.type] || 0;

  // If same type, compare by rank
  if (newCombo.type === currentCombo.type) {
    return newCombo.rank > currentCombo.rank;
  }

  // Different types, compare by power level
  return newPower > currentPower;
}

// Get all valid moves for a player
function getValidMoves(playerHand, currentCombo) {
  const validMoves = [];

  if (!currentCombo) {
    // Any valid combination is allowed
    for (let i = 1; i <= playerHand.length; i++) {
      const combinations = generateCombinations(playerHand, i);
      combinations.forEach(combo => {
        if (validateCombination(combo)) {
          validMoves.push(combo);
        }
      });
    }
  } else {
    // Must match current combination type
    const requiredType = currentCombo.type;
    let comboSize;

    switch (requiredType) {
      case 'single': comboSize = 1; break;
      case 'pair': comboSize = 2; break;
      case 'triple': comboSize = 3; break;
      case 'quad': comboSize = 4; break;
      case 'straight': comboSize = currentCombo.length; break;
      // Note: double_sequence not implemented in validateCombination
      // case 'double_sequence': comboSize = currentCombo.length * 2; break;
      default:
        return validMoves;
    }

    const combinations = generateCombinations(playerHand, comboSize);

    combinations.forEach(combo => {
      const validatedCombo = validateCombination(combo);
      if (validatedCombo && validatedCombo.type === requiredType &&
          canBeatCombination(validatedCombo, currentCombo)) {
        validMoves.push(combo);
      }
    });
  }

  return validMoves;
}

// Generate combinations
function generateCombinations(array, k) {
  const result = [];

  function combine(start, current) {
    if (current.length === k) {
      result.push([...current]);
      return;
    }

    for (let i = start; i < array.length; i++) {
      current.push(array[i]);
      combine(i + 1, current);
      current.pop();
    }
  }

  combine(0, []);
  return result;
}

export {
  validateCombination,
  canBeatCombination,
  getValidMoves,
  sortCards,
  parseCard
};