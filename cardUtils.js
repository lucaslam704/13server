// Simple card utilities for server-side use
// Card format: "RS" where R is rank, S is suit

// Card ranking system
export const RANK_ORDER = {
  '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, '10': 8,
  'J': 9, 'Q': 10, 'K': 11, 'A': 12, '2': 13
};

export const SUIT_ORDER = {
  '♠': 1, // Spades (lowest)
  '♣': 2, // Clubs
  '♦': 3, // Diamonds
  '♥': 4  // Hearts (highest)
};

// Generate a standard 52-card deck
export function generateDeck() {
  const suits = ['♠', '♣', '♦', '♥'];
  const ranks = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(`${rank}${suit}`);
    }
  }

  return deck;
}

// Shuffle deck using Fisher-Yates algorithm
export function shuffleDeck(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
}

// Deal cards to players
export function dealCards(room) {
  const deck = generateDeck();
  shuffleDeck(deck);

  // Deal to all connected players, regardless of seating
  const players = room.players.filter(p => p.connected);

  if (players.length === 0) {
    console.log(`No connected players to deal cards to in room ${room.id}`);
    return;
  }

  console.log(`Dealing cards to ${players.length} connected players in room ${room.id}`);

  // In Thirteen (Big Two), each player gets exactly 13 cards
  const cardsPerPlayer = 13;
  let cardIndex = 0;

  players.forEach((player, index) => {
    if (player) {
      const startIndex = cardIndex;
      const endIndex = startIndex + cardsPerPlayer;
      player.hand = deck.slice(startIndex, endIndex);
      cardIndex = endIndex;
      console.log(`Player ${player.name} (${player.id}) received ${player.hand.length} cards`);
    }
  });

  // In Thirteen, we only deal 13 cards per player, regardless of player count
  // The remaining cards are not dealt to players
  const totalCardsDealt = players.length * cardsPerPlayer;
  const remainingCards = deck.length - totalCardsDealt;

  console.log(`Cards dealt: ${totalCardsDealt}, Remaining in deck: ${remainingCards}`);

  console.log(`Finished dealing cards. Total cards dealt: ${deck.length}`);
  players.forEach(player => {
    console.log(`- ${player.name}: ${player.hand.length} cards`);
  });
}

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

// Sort cards by rank and suit
function sortCards(cards) {
  return [...cards].sort((a, b) => {
    const cardA = parseCard(a);
    const cardB = parseCard(b);

    // First compare by rank
    if (cardA.rankValue !== cardB.rankValue) {
      return cardA.rankValue - cardB.rankValue;
    }

    // If ranks are equal, compare by suit
    return cardA.suitValue - cardB.suitValue;
  });
}

// Validate combination
export function validateCombination(cards) {
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

  // Pair (two cards of same rank)
  if (cards.length === 2) {
    if (parsedCards[0].rankValue === parsedCards[1].rankValue) {
      const card = parsedCards[0];
      return {
        type: 'pair',
        cards: sortedCards,
        rank: card.rankValue * 10 + Math.max(card.suitValue, parsedCards[1].suitValue),
        length: 2
      };
    }
  }

  // Triple (three cards of same rank)
  if (cards.length === 3) {
    if (parsedCards.every(c => c.rankValue === parsedCards[0].rankValue)) {
      const card = parsedCards[0];
      return {
        type: 'triple',
        cards: sortedCards,
        rank: card.rankValue * 10 + Math.max(...parsedCards.map(c => c.suitValue)),
        length: 3
      };
    }
  }

  // Quad (four cards of same rank)
  if (cards.length === 4) {
    if (parsedCards.every(c => c.rankValue === parsedCards[0].rankValue)) {
      const card = parsedCards[0];
      return {
        type: 'quad',
        cards: sortedCards,
        rank: card.rankValue * 10 + Math.max(...parsedCards.map(c => c.suitValue)),
        length: 4
      };
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

  return null; // Invalid combination
}

// Check if a combination can beat another combination
export function canBeatCombination(newCombo, currentCombo) {
  // If no current combination, any valid combination can start
  if (!currentCombo) return true;

  // Must be same type
  if (newCombo.type !== currentCombo.type) {
    return false;
  }

  // For straights, must have same length
  if (newCombo.type === 'straight' && newCombo.length !== currentCombo.length) {
    return false;
  }

  // Compare ranks for same type combinations
  return newCombo.rank > currentCombo.rank;
}

export { generateDeck as makeDeck };