import { rooms } from './roomManager.js';
import { saveRoomToDB, deleteRoomFromDB, getRoomsFromDB } from './databaseHelpers.js';
import { makeBotMove } from './botLogic.js';
import { createCleanRoomData } from './roomHelpers.js';

function setupConnectionHandlers(io, supabase) {
  io.on("connection", (socket) => {
    socket.on("disconnect", async () => {
      console.log(`User ${socket.id} disconnected`);

      // Mark player as disconnected in all rooms (don't remove them)
      for (const [roomId, room] of rooms) {
        let roomChanged = false;

        // Find player in room
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          const player = room.players[playerIndex];
          player.connected = false;
          roomChanged = true;
          console.log(`Marked player ${socket.id} as disconnected in room ${roomId}`);

          // Reset countdown when someone disconnects
          if (room.countdownInterval) {
            clearInterval(room.countdownInterval);
            room.countdownInterval = null;
          }
          room.countdownTime = null;

          // If it was this player's turn and game is in progress, auto-pass after 2 seconds
          if (room.gameStarted && room.turn === socket.id) {
            setTimeout(async () => {
              // Check if player is still disconnected and still their turn
              const currentPlayer = room.players.find(p => p.id === socket.id);
              if (currentPlayer && !currentPlayer.connected && room.turn === socket.id) {
                console.log(`Auto-passing for disconnected player ${socket.id} in room ${roomId}`);

                // Add to passes
                if (!room.passes.includes(socket.id)) {
                  room.passes.push(socket.id);
                }

                // Check if all other players passed (start new round)
                const activePlayers = room.players.filter(p => p.hand.length > 0);
                const passedPlayers = activePlayers.filter(p => room.passes.includes(p.id));

                if (passedPlayers.length === activePlayers.length - 1) {
                  // All players passed, start new round
                  room.currentCombination = null;
                  room.passes = [];
                  room.pile = [];
                  room.round = (room.round || 1) + 1;

                  // Turn goes to the player who played the last card
                  if (room.lastPlayer) {
                    room.turn = room.lastPlayer;
                  }
                } else {
                  // Move to next player
                  const currentIdx = room.players.findIndex(p => p.id === socket.id);
                  const nextPlayerIdx = (currentIdx + 1) % room.players.length;
                  const nextPlayer = room.players[nextPlayerIdx];

                  // Skip disconnected players
                  if (!nextPlayer.connected) {
                    // Find next connected player
                    let foundValidPlayer = false;
                    for (let i = 1; i < room.players.length; i++) {
                      const checkIdx = (currentIdx + i) % room.players.length;
                      const checkPlayer = room.players[checkIdx];
                      if (checkPlayer.connected) {
                        room.turn = checkPlayer.id;
                        foundValidPlayer = true;
                        break;
                      }
                    }
                    if (!foundValidPlayer) {
                      room.turn = nextPlayer.id; // Fallback
                    }
                  } else {
                    room.turn = nextPlayer.id;
                  }
                }

                // Save and broadcast updated room
                await saveRoomToDB(room, supabase);
                io.to(roomId).emit("game_update", createCleanRoomData(room));
              }
            }, 2000); // 2 seconds delay
          }
        }

        // Save room changes to database
        if (roomChanged) {
          await saveRoomToDB(room, supabase);
          console.log(`Saved room changes for ${roomId} to database`);
        }

        // Broadcast room update
        io.to(roomId).emit("room_update", createCleanRoomData(room));
        console.log(`Broadcasted room update for ${roomId}`);
      }

      // Broadcast updated room list
      const roomsList = await getRoomsFromDB(supabase);
      io.emit("rooms_list", roomsList);
      console.log(`Broadcasted updated room list`);
    });
  });
}

export { setupConnectionHandlers };