// Card utilities and validation functions

// Create shuffled deck
function makeDeck() {
  const suits = ["♠", "♣", "♦", "♥"]; // Use Unicode symbols for consistency with client
  const ranks = ["3","4","5","6","7","8","9","10","J","Q","K","A","2"];
  const deck = [];
  for (const r of ranks) for (const s of suits) deck.push(r + s);
  return deck.sort(() => Math.random() - 0.5);
}

// Deal cards to players
function dealCards(room) {
  // Deal cards to seated players only
  const seatedPlayers = room.players.filter(p => p.chair !== null);
  const deck = makeDeck();

  // In Thirteen card game, each player gets exactly 13 cards
  const CARDS_PER_PLAYER = 13;

  seatedPlayers.forEach((player, index) => {
    const startIndex = index * CARDS_PER_PLAYER;
    const endIndex = startIndex + CARDS_PER_PLAYER;
    player.hand = deck.slice(startIndex, endIndex);
  });
}

// Get card rank value
function getCardRank(card) {
  // Handle both Unicode symbols and letter codes
  let rank;
  if (card.length === 3 && card.includes('10')) {
    rank = '10';
  } else {
    rank = card.slice(0, -1);
  }
  const rankOrder = { '3':1, '4':2, '5':3, '6':4, '7':5, '8':6, '9':7, '10':8, 'J':9, 'Q':10, 'K':11, 'A':12, '2':13 };
  return rankOrder[rank] || 0;
}

// Get card suit value for tie-breaking
function getCardSuit(card) {
  const suit = card.slice(-1);
  const suitOrder = { '♠':1, '♣':2, '♦':3, '♥':4 };
  return suitOrder[suit] || 0;
}

// Validate combination (simplified server-side validation)
function validateCombination(cards) {
  if (!cards || cards.length === 0) return null;

  // Sort cards for consistent comparison
  const sortedCards = [...cards].sort((a, b) => {
    const rankA = getCardRank(a);
    const rankB = getCardRank(b);
    if (rankA !== rankB) return rankA - rankB;
    return getCardSuit(a) - getCardSuit(b);
  });

  // Single card
  if (cards.length === 1) {
    const card = sortedCards[0];
    return {
      type: 'single',
      cards: sortedCards,
      rank: getCardRank(card) * 10 + getCardSuit(card)
    };
  }

  // Pair
  if (cards.length === 2 && getCardRank(sortedCards[0]) === getCardRank(sortedCards[1])) {
    const card = sortedCards[0];
    return {
      type: 'pair',
      cards: sortedCards,
      rank: getCardRank(card) * 10 + Math.max(...sortedCards.map(getCardSuit))
    };
  }

  // Triple
  if (cards.length === 3 && sortedCards.every(c => getCardRank(c) === getCardRank(sortedCards[0]))) {
    const card = sortedCards[0];
    return {
      type: 'triple',
      cards: sortedCards,
      rank: getCardRank(card) * 10 + Math.max(...sortedCards.map(getCardSuit))
    };
  }

  // Quad
  if (cards.length === 4 && sortedCards.every(c => getCardRank(c) === getCardRank(sortedCards[0]))) {
    const card = sortedCards[0];
    return {
      type: 'quad',
      cards: sortedCards,
      rank: getCardRank(card) * 10 + Math.max(...sortedCards.map(getCardSuit))
    };
  }

  // Four of a kind (6♥ 6♦ 6♣ 6♠)
  if (cards.length === 4) {
    const rankGroups = {};
    sortedCards.forEach((card, index) => {
      const rank = getCardRank(card);
      if (!rankGroups[rank]) {
        rankGroups[rank] = [];
      }
      rankGroups[rank].push(card);
    });

    // Check if any rank has exactly 4 cards
    for (const rank in rankGroups) {
      if (rankGroups[rank].length === 4) {
        const rankValue = parseInt(rank);
        return {
          type: 'four_of_kind',
          cards: sortedCards,
          rank: rankValue * 10 + 3, // Base rank for four of a kind
          length: 4,
          power: 2 // Four of a Kind - middle power
        };
      }
    }
  }

  // Three pairs (continuous pairs)
  if (cards.length === 6) {
    const pairs = getPairsFromCardsServer(sortedCards);
    if (pairs.length === 3) {
      // Check if pairs are continuous
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
          rank: highestRank * 10 + 1, // Base rank for three pairs
          length: 3,
          power: 1 // Three Pairs - lowest power
        };
      }
    }
  }

  // Four pairs (continuous pairs)
  if (cards.length === 8) {
    const pairs = getPairsFromCardsServer(sortedCards);
    if (pairs.length === 4) {
      // Check if pairs are continuous
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
          rank: highestRank * 10 + 2, // Base rank for four pairs
          length: 4,
          power: 3 // Four Pairs - highest power
        };
      }
    }
  }

  // Straight validation (3+ consecutive cards, NO 2s allowed)
  if (cards.length >= 3) {
    // Check for 2s - straights cannot contain 2s
    if (sortedCards.some(card => getCardRank(card) === 13)) { // 13 is the value for '2'
      return null; // Invalid straight - contains 2
    }

    const isStraight = sortedCards.every((card, index) => {
      if (index === 0) return true;
      return getCardRank(card) === getCardRank(sortedCards[index - 1]) + 1;
    });

    if (isStraight) {
      // For straights, use the highest card's rank and suit for comparison
      const highestCard = sortedCards[sortedCards.length - 1];
      return {
        type: 'straight',
        cards: sortedCards,
        rank: getCardRank(highestCard) * 10 + getCardSuit(highestCard),
        length: cards.length
      };
    }
  }

  return null;
}

// Helper function to extract pairs from cards
function getPairsFromCardsServer(sortedCards) {
  const rankGroups = {};

  sortedCards.forEach(card => {
    const rank = getCardRank(card);
    if (!rankGroups[rank]) {
      rankGroups[rank] = [];
    }
    rankGroups[rank].push(card);
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

// Check if combination can beat current
function canBeatCombination(newCombo, currentCombo) {
  // If no current combination, any valid combination can start
  if (!currentCombo) return true;

  // Special case: Check if current combo is a single 2
  const isCurrentTwo = currentCombo.type === 'single' && getCardRank(currentCombo.cards[0]) === 13;

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

export {
  makeDeck,
  dealCards,
  getCardRank,
  getCardSuit,
  validateCombination,
  getPairsFromCardsServer,
  canBeatCombination,
  isSpecialCombination,
  compareSpecialCombinations
};