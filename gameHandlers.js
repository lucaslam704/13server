import { getRoom, getStartingPlayerForRoom } from './roomManager.js';
import { dealCards } from './cardUtils.js';
import { makeBotMove } from './botLogic.js';
import { createCleanRoomData } from './roomHelpers.js';

function setupGameHandlers(io, supabase) {
  io.on("connection", (socket) => {
    socket.on("start_game", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

      // Check if user is the room owner (compare with authenticated user ID or socket ID)
      const isOwner = room.players.some(p => p.id === socket.id && (p.userId === room.owner || p.id === room.owner));
      if (!isOwner) {
        socket.emit("error", "Only the room owner can start the game");
        return;
      }

      // Ensure room properties are initialized
      if (!room.players) room.players = [];

      // Check if all OTHER seated players are ready (exclude owner)
      const seatedPlayers = room.players.filter(p => p.chair !== null);
      if (seatedPlayers.length < 2) return; // Need at least 2 players

      const otherPlayersReady = seatedPlayers.filter(p => p.id !== socket.id).every(p => p.ready);
      if (!otherPlayersReady) return; // All other players must be ready

      // Reset game state completely before starting new game
      room.gameStarted = true;
      room.pile = [];
      room.currentCombination = null;
      room.winner = null;
      room.passes = [];
      room.lastPlayer = null;
      room.turn = null;
      room.round = 1; // Reset round counter to 1
      room.deckShuffled = true; // Flag to indicate deck is ready

      // Clear all players' hands to ensure clean slate
      room.players.forEach(player => {
        player.hand = [];
        player.ready = false; // Reset ready status for new game
      });

      console.log(`Game restarted in room ${roomId} with ${seatedPlayers.length} players`);
      io.to(roomId).emit("game_started", room);
    });

    // Add explicit restart_game handler for better game restart flow
    socket.on("restart_game", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

      // Check if user is the room owner (compare with authenticated user ID or socket ID)
      const isOwner = room.players.some(p => p.id === socket.id && (p.userId === room.owner || p.id === room.owner));
      if (!isOwner) {
        socket.emit("error", "Only the room owner can restart the game");
        return;
      }

      // Ensure room properties are initialized
      if (!room.players) room.players = [];

      // Check if there are enough seated players
      const seatedPlayers = room.players.filter(p => p.chair !== null);
      if (seatedPlayers.length < 2) {
        // Allow single player to restart (for testing/development)
        console.log(`Allowing single player restart in room ${roomId}`);
      }

      // Check if all OTHER seated players are ready (exclude owner)
      const otherPlayers = seatedPlayers.filter(p => p.id !== socket.id);
      const otherPlayersReady = otherPlayers.length === 0 || otherPlayers.every(p => p.ready);
      if (!otherPlayersReady) {
        socket.emit("error", "All other players must be ready to restart the game");
        return;
      }

      // Reset game state completely
      room.gameStarted = true;
      room.pile = [];
      room.currentCombination = null;
      room.winner = null;
      room.winnerLastCards = null; // Clear winner's last cards
      room.passes = [];
      room.lastPlayer = null;
      room.turn = null;
      room.round = 1;
      room.deckShuffled = true;

      // Clear all players' hands and reset ready status
      room.players.forEach(player => {
        player.hand = [];
        player.ready = false;
      });

      console.log(`Game explicitly restarted in room ${roomId} with ready check`);

      // Emit restart event first
      io.to(roomId).emit("game_restarted", createCleanRoomData(room));

      // Small delay before emitting game_started to allow client to process restart
      setTimeout(() => {
        io.to(roomId).emit("game_started", createCleanRoomData(room));
      }, 100);
    });

    // New event to deal cards after animation completes
    socket.on("deal_cards", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up
      if (!room.gameStarted || !room.deckShuffled) return;

      dealCards(room);

      // Set the first player
      room.turn = getStartingPlayerForRoom(room);
      room.deckShuffled = false; // Reset flag

      io.to(roomId).emit("cards_dealt", createCleanRoomData(room));

      // If first player is a bot, make them move after a delay
      const firstPlayer = room.players.find(p => p.id === room.turn);
      if (firstPlayer && firstPlayer.isBot) {
        setTimeout(() => makeBotMove(room, firstPlayer, io), 1000);
      }
    });
  });
}

export { setupGameHandlers };