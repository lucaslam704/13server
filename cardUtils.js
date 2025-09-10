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

  const cardsPerPlayer = Math.floor(deck.length / players.length);
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

  // Handle remaining cards (distribute evenly)
  let remainingCardIndex = 0;
  while (cardIndex < deck.length && players.length > 0) {
    const playerIndex = remainingCardIndex % players.length;
    if (players[playerIndex]) {
      players[playerIndex].hand.push(deck[cardIndex]);
      console.log(`Extra card ${deck[cardIndex]} given to ${players[playerIndex].name}`);
    }
    cardIndex++;
    remainingCardIndex++;
  }

  console.log(`Finished dealing cards. Total cards dealt: ${deck.length}`);
  players.forEach(player => {
    console.log(`- ${player.name}: ${player.hand.length} cards`);
  });
}

// Simple combination validation (basic implementation)
export function validateCombination(cards) {
  if (!cards || cards.length === 0) return null;

  // For now, just return a basic combination object
  // This is a simplified version - the full validation is in TypeScript files
  return {
    type: cards.length === 1 ? 'single' : cards.length === 2 ? 'pair' : 'unknown',
    length: cards.length,
    rank: 1,
    cards: cards
  };
}

// Simple combination comparison (basic implementation)
export function canBeatCombination(newCombo, currentCombo) {
  if (!currentCombo) return true;

  // Simplified comparison - just check if new combo has higher rank
  return newCombo.rank > currentCombo.rank;
}

export { generateDeck as makeDeck };