// Socket event handlers with Supabase integration
import { rooms, getRoom, getOrCreateRoom, getStartingPlayerForRoom, setDatabaseLoader } from './roomManager.js';
import { makeDeck, dealCards, validateCombination, canBeatCombination } from './cardUtils.js';
import { makeBotMove, handleBotPlay, handleBotPass } from './botLogic.js';

// Database helper functions
async function saveRoomToDB(room, supabaseClient) {
  try {
    console.log('saveRoomToDB called with room:', {
      id: room.id,
      owner: room.owner,
      name: room.name,
      playersCount: room.players?.length || 0
    });

    // Get the actual user UUID for the room owner
    let roomOwnerId = room.owner;

    // If room.owner is a socket ID, try to find the corresponding user UUID
    if (room.players && room.players.length > 0) {
      const ownerPlayer = room.players.find(p => p.id === room.owner);
      if (ownerPlayer && ownerPlayer.userId && ownerPlayer.userId !== room.owner) {
        roomOwnerId = ownerPlayer.userId;
      }
    }

    console.log('Resolved room owner ID:', { original: room.owner, resolved: roomOwnerId });

    // If we still don't have a valid UUID, skip database operation
    if (!roomOwnerId || roomOwnerId.startsWith('socket_') || roomOwnerId.length < 20) {
      console.log('Skipping database save - no valid user UUID for room:', room.id, '- Owner ID:', roomOwnerId);
      console.log('Room will be saved in memory only');
      return { success: true, inMemoryOnly: true };
    }

    const upsertData = {
      room_id: room.id,
      room_owner_id: roomOwnerId,
      room_owner_name: room.name,
      max_players: 4,
      current_players: room.players.length + room.viewers.length,
      players_in_seats: room.players.map(p => p.userId && p.userId !== p.id ? p.userId : null).filter(id => id !== null),
      spectators: room.viewers.map(v => v.userId && v.userId !== v.id ? v.userId : null).filter(id => id !== null),
      game_started: room.gameStarted,
      game_state: {
        pile: room.pile,
        currentCombination: room.currentCombination,
        turn: room.turn,
        passes: room.passes,
        lastPlayer: room.lastPlayer,
        winner: room.winner,
        round: room.round,
        deckShuffled: room.deckShuffled
      },
      is_active: true,
      updated_at: new Date().toISOString()
    };

    console.log('Attempting to upsert room data:', JSON.stringify(upsertData, null, 2));

    const { data, error } = await supabaseClient
      .from('thirteen_rooms')
      .upsert(upsertData, {
        onConflict: 'room_id'
      });

    if (error) {
      console.error('Error saving room to DB:', error);
      // If it's a foreign key constraint error, log it but don't crash
      if (error.code === '23503') {
        console.log('Foreign key constraint error - likely invalid user UUID. Room saved in memory only.');
        return { success: true, inMemoryOnly: true };
      }
      return { success: false, error };
    }

    console.log('Successfully saved room to database:', room.id);
    return { success: true };
  } catch (err) {
    console.error('Error in saveRoomToDB:', err);
    return { success: false, error: err };
  }
}

async function loadRoomFromDB(roomId, supabaseClient) {
  try {
    const { data, error } = await supabaseClient
      .from('thirteen_rooms')
      .select('*')
      .eq('room_id', roomId)
      .eq('is_active', true)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
      console.error('Error loading room from DB:', error);
      return null;
    }

    if (!data) {
      return null;
    }

    console.log('Successfully loaded room from database:', roomId);
    return data;
  } catch (err) {
    console.error('Error in loadRoomFromDB:', err);
    return null;
  }
}

async function deleteRoomFromDB(roomId, supabaseClient) {
  try {
    const { error } = await supabaseClient
      .from('thirteen_rooms')
      .update({ is_active: false })
      .eq('room_id', roomId);

    if (error) {
      console.error('Error deleting room from DB:', error);
      return { success: false, error };
    }

    console.log('Successfully deleted room from database:', roomId);
    return { success: true };
  } catch (err) {
    console.error('Error in deleteRoomFromDB:', err);
    return { success: false, error: err };
  }
}

async function getRoomsFromDB(supabaseClient) {
  try {
    const { data, error } = await supabaseClient
      .from('thirteen_rooms')
      .select('*')
      .eq('is_active', true)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error getting rooms from DB:', error);
      return [];
    }

    console.log('Successfully loaded rooms list from database');
    return data.map(room => ({
      id: room.room_id,
      owner: room.room_owner_id,
      playerCount: room.current_players,
      gameStarted: room.game_started,
      created: new Date(room.created_at).getTime()
    }));
  } catch (err) {
    console.error('Error in getRoomsFromDB:', err);
    return [];
  }
}

// Helper function to fetch and update profile pictures for players
async function updatePlayerProfilePics(room, supabaseClient) {
  if (!room.players || room.players.length === 0) return;

  // Get all user IDs that need profile pictures
  const userIds = room.players
    .filter(p => p.userId && !p.isBot)
    .map(p => p.userId);

  if (userIds.length === 0) return;

  try {
    const { data, error } = await supabaseClient
      .from('users')
      .select('id, profile_pic')
      .in('id', userIds);

    if (error) {
      console.error('Error fetching profile pictures:', error);
      return;
    }

    // Update player objects with profile pictures
    room.players.forEach(player => {
      if (player.userId && !player.isBot) {
        const userData = data.find(u => u.id === player.userId);
        if (userData) {
          player.profilePic = userData.profile_pic;
        }
      }
    });

    console.log('Updated profile pictures for players in room:', room.id);
  } catch (err) {
    console.error('Error updating player profile pictures:', err);
  }
}

function setupSocketHandlers(io, supabase) {
  // Inject the database loader function
  setDatabaseLoader((roomId) => loadRoomFromDB(roomId, supabase));

  // Periodic cleanup of empty rooms (every 5 minutes)
  setInterval(async () => {
    console.log('Running periodic room cleanup...');
    for (const [roomId, room] of rooms) {
      const totalPlayers = room.players.length + room.viewers.length;
      if (totalPlayers === 0) {
        console.log(`Cleaning up empty room: ${roomId}`);
        await deleteRoomFromDB(roomId, supabase);
        rooms.delete(roomId);
      }
    }
  }, 5 * 60 * 1000); // 5 minutes

  io.on("connection", (socket) => {
    console.log("Connected:", socket.id);

    socket.on("get_rooms", async () => {
      const roomsList = await getRoomsFromDB(supabase);
      socket.emit("rooms_list", roomsList);
    });

    socket.on("create_room", async (roomId, name, userId) => {
      console.log('Create room request:', { roomId, name, userId, socketId: socket.id });

      // Validate required parameters
      if (!roomId || !name) {
        socket.emit("error", "Room ID and name are required");
        return;
      }

      // Use authenticated user UUID if available, otherwise fall back to socket ID
      const authenticatedUserId = userId && userId !== socket.id ? userId : null;
      const playerIdentifier = authenticatedUserId || socket.id;

      console.log('Creating room with:', { roomId, playerIdentifier, name, authenticatedUserId });

      const room = await getOrCreateRoom(roomId, playerIdentifier, name);
      console.log('Room created:', { id: room.id, owner: room.owner, name: room.name });

      socket.join(roomId);

      // Ensure room.players is initialized
      if (!room.players) {
        room.players = [];
      }
      if (!room.viewers) {
        room.viewers = [];
      }
      if (!room.chairs) {
        room.chairs = [null, null, null, null];
      }

      // Auto-seat the room owner in chair 0
      room.players.push({
        id: socket.id, // Always use socket ID for socket operations
        userId: authenticatedUserId, // Store authenticated user UUID separately
        name: name,
        hand: [],
        connected: true,
        chair: 0,
        ready: false,
        profilePic: null // Will be updated when user data is fetched
      });
      room.chairs[0] = socket.id;

      // Save to database (will use authenticatedUserId if available)
      await saveRoomToDB(room, supabase);

      // Update profile pictures for players
      await updatePlayerProfilePics(room, supabase);

      // Broadcast room update
      io.to(roomId).emit("room_update", room);
      socket.emit("room_joined", room);

      // Broadcast updated room list to all clients
      const roomsList = await getRoomsFromDB(supabase);
      io.emit("rooms_list", roomsList);
    });

    socket.on("join_room", async (roomId, name, userId) => {
      const room = await getRoom(roomId);
      if (!room) {
        socket.emit("error", "Room not found");
        return;
      }

      socket.join(roomId);

      // Ensure room properties are initialized
      if (!room.players) room.players = [];
      if (!room.viewers) room.viewers = [];

      // Use authenticated user UUID if available
      const authenticatedUserId = userId && userId !== socket.id ? userId : null;

      // Check if this player was previously the room owner (compare with authenticated user or socket)
      const wasOwner = room.owner === authenticatedUserId || room.owner === socket.id;

      // If they were the owner and there are no human players, restore ownership
      if (wasOwner && room.players.filter(p => !p.isBot).length === 0) {
        room.owner = authenticatedUserId || socket.id;
      }

      // Check if player is already in viewers (prevent duplication)
      const existingViewerIndex = room.viewers.findIndex(v => v.id === socket.id);
      if (existingViewerIndex === -1) {
        room.viewers.push({
          id: socket.id,
          userId: authenticatedUserId, // Store authenticated user UUID separately
          name
        });
      }

      // Save to database
      await saveRoomToDB(room, supabase);

      // Update profile pictures for players
      await updatePlayerProfilePics(room, supabase);

      // Broadcast room update
      io.to(roomId).emit("room_update", room);
      socket.emit("room_joined", room);

      // Broadcast updated room list to all clients
      const roomsList = await getRoomsFromDB(supabase);
      io.emit("rooms_list", roomsList);
    });

    socket.on("sit_chair", async (roomId, chairIndex) => {
      const room = await getRoom(roomId);
      if (!room || chairIndex < 0 || chairIndex >= 4) return;

      // Ensure room properties are initialized
      if (!room.players) room.players = [];
      if (!room.viewers) room.viewers = [];
      if (!room.chairs) room.chairs = [null, null, null, null];

      // Check if chair is empty
      if (room.chairs[chairIndex] !== null) {
        socket.emit("error", "Chair is occupied");
        return;
      }

      // Find player in viewers
      const viewerIndex = room.viewers.findIndex(v => v.id === socket.id);
      if (viewerIndex === -1) return;

      const viewer = room.viewers[viewerIndex];
      room.viewers.splice(viewerIndex, 1);

      // Add to players and assign chair
      room.players.push({
        id: socket.id,
        userId: viewer.userId, // Use the authenticated user UUID if available
        name: viewer.name,
        hand: [],
        connected: true,
        chair: chairIndex,
        ready: false,
        profilePic: null // Will be updated when user data is fetched
      });

      room.chairs[chairIndex] = socket.id;

      // Save to database
      await saveRoomToDB(room, supabase);

      // Update profile pictures for players
      await updatePlayerProfilePics(room, supabase);

      io.to(roomId).emit("room_update", room);
    });

    socket.on("stand_up", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return;

      // Ensure room properties are initialized
      if (!room.players) room.players = [];
      if (!room.viewers) room.viewers = [];
      if (!room.chairs) room.chairs = [null, null, null, null];

      // Find player
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex === -1) return;

      const player = room.players[playerIndex];
      const chairIndex = player.chair;

      // Remove from players
      room.players.splice(playerIndex, 1);
      room.chairs[chairIndex] = null;

      // Add back to viewers
      room.viewers.push({
        id: socket.id,
        userId: player.userId, // Use the authenticated user UUID if available
        name: player.name
      });

      io.to(roomId).emit("room_update", room);
    });

    socket.on("toggle_ready", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return;

      // Ensure room properties are initialized
      if (!room.players) room.players = [];

      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      player.ready = !player.ready;
      io.to(roomId).emit("room_update", room);
    });

    socket.on("add_bot", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return;

      // Check if user is the room owner (compare with authenticated user ID or socket ID)
      const isOwner = room.players.some(p => p.id === socket.id && (p.userId === room.owner || p.id === room.owner));
      if (!isOwner) return;

      // Ensure room properties are initialized
      if (!room.players) room.players = [];
      if (!room.chairs) room.chairs = [null, null, null, null];

      // Find empty chair
      const emptyChairIndex = room.chairs.findIndex(chair => chair === null);
      if (emptyChairIndex === -1) return; // No empty chairs

      // Create bot
      const botId = `bot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const botName = `Bot ${room.players.filter(p => p.name.startsWith('Bot ')).length + 1}`;

      const bot = {
        id: botId,
        name: botName,
        hand: [],
        connected: true,
        chair: emptyChairIndex,
        ready: true, // Bots are always ready
        isBot: true,
        profilePic: null // Bots don't have profile pictures
      };

      room.players.push(bot);
      room.chairs[emptyChairIndex] = botId;

      io.to(roomId).emit("room_update", room);
    });

    socket.on("remove_bot", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return;

      // Check if user is the room owner (compare with authenticated user ID or socket ID)
      const isOwner = room.players.some(p => p.id === socket.id && (p.userId === room.owner || p.id === room.owner));
      if (!isOwner) return;

      // Ensure room properties are initialized
      if (!room.players) room.players = [];
      if (!room.chairs) room.chairs = [null, null, null, null];

      // Find and remove a bot
      const botIndex = room.players.findIndex(p => p.name.startsWith('Bot '));
      if (botIndex === -1) return;

      const bot = room.players[botIndex];
      room.players.splice(botIndex, 1);
      room.chairs[bot.chair] = null;

      io.to(roomId).emit("room_update", room);
    });

    socket.on("start_game", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return;

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
      if (!room) return;

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
        socket.emit("error", "Need at least 2 players to restart the game");
        return;
      }

      // Check if all OTHER seated players are ready (exclude owner)
      const otherPlayersReady = seatedPlayers.filter(p => p.id !== socket.id).every(p => p.ready);
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
      io.to(roomId).emit("game_restarted", room);

      // Small delay before emitting game_started to allow client to process restart
      setTimeout(() => {
        io.to(roomId).emit("game_started", room);
      }, 100);
    });

    // New event to deal cards after animation completes
    socket.on("deal_cards", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room || !room.gameStarted || !room.deckShuffled) return;

      dealCards(room);

      // Set the first player
      room.turn = getStartingPlayerForRoom(room);
      room.deckShuffled = false; // Reset flag

      io.to(roomId).emit("cards_dealt", room);

      // If first player is a bot, make them move after a delay
      const firstPlayer = room.players.find(p => p.id === room.turn);
      if (firstPlayer && firstPlayer.isBot) {
        setTimeout(() => makeBotMove(room, firstPlayer, io), 1000);
      }
    });

    socket.on("play_cards", async ({ roomId, cards }) => {
      const room = await getRoom(roomId);
      if (!room || !room.gameStarted) return;

      const player = room.players.find(p => p.id === socket.id);
      if (!player || room.turn !== socket.id) return;

      console.log(`[DEBUG] Player ${player.name} (${socket.id}) playing cards in round ${room.round}: [${cards.join(', ')}]`);
      console.log(`[DEBUG] Current passes before play: [${room.passes.join(', ')}]`);

      // Validate the combination
      const combination = validateCombination(cards);
      if (!combination) {
        console.log(`[DEBUG] Invalid combination played by ${player.name}`);
        return; // Invalid combination
      }

      // Check if it can beat the current combination
      if (!canBeatCombination(combination, room.currentCombination)) {
        console.log(`[DEBUG] Combination cannot beat current combination for ${player.name}`);
        return;
      }

      // Check if player has all the cards
      const hasAllCards = cards.every(card => player.hand.includes(card));
      if (!hasAllCards) {
        console.log(`[DEBUG] Player ${player.name} doesn't have all required cards`);
        return;
      }

      // Remove played cards from hand
      player.hand = player.hand.filter(c => !cards.includes(c));
      room.pile = cards;
      room.currentCombination = combination;
      // Don't reset passes here - only reset when a new round actually starts
      room.lastPlayer = player.id; // Track who played last

      console.log(`[DEBUG] Play successful! Passes unchanged: [${room.passes.join(', ')}]`);
      console.log(`[DEBUG] Last player set to: ${player.name} (${player.id})`);

      // Check if player won
      if (player.hand.length === 0) {
        room.winner = player.id;
        room.winnerLastCards = cards; // Store the winning cards
        room.gameStarted = false;
        console.log(`[DEBUG] Player ${player.name} won the game with cards: [${cards.join(', ')}]`);
      } else {
        // Move to next player
        const currentIdx = room.players.findIndex(p => p.id === socket.id);
        const nextPlayerIdx = (currentIdx + 1) % room.players.length;
        const nextPlayer = room.players[nextPlayerIdx];

        // Skip players who have passed this round
        if (room.passes.includes(nextPlayer.id)) {
          console.log(`[DEBUG] Next player ${nextPlayer.name} has already passed this round, skipping...`);
          // Find the next player who hasn't passed
          let foundValidPlayer = false;
          for (let i = 1; i < room.players.length; i++) {
            const checkIdx = (currentIdx + i) % room.players.length;
            const checkPlayer = room.players[checkIdx];
            if (!room.passes.includes(checkPlayer.id)) {
              room.turn = checkPlayer.id;
              console.log(`[DEBUG] Found valid next player: ${checkPlayer.name} (${checkPlayer.id})`);
              foundValidPlayer = true;
              break;
            }
          }
          if (!foundValidPlayer) {
            console.log(`[DEBUG] ERROR: No valid players found to take turn!`);
          }
        } else {
          room.turn = nextPlayer.id;
          console.log(`[DEBUG] Turn moved to: ${nextPlayer.name} (${nextPlayer.id})`);
        }

        // If next player is a bot, make them move
        const nextPlayerObj = room.players.find(p => p.id === room.turn);
        if (nextPlayerObj && nextPlayerObj.isBot) {
          setTimeout(() => makeBotMove(room, nextPlayerObj, io), 1000);
        }
      }

      console.log(`[DEBUG] Final turn after play: ${room.players.find(p => p.id === room.turn)?.name} (${room.turn})`);
      console.log(`[DEBUG] --- End of play_cards handler ---\n`);

      io.to(roomId).emit("game_update", room);
    });

    socket.on("pass", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room || !room.gameStarted || room.turn !== socket.id) return;

      const playerId = socket.id;
      const playerName = room.players.find(p => p.id === playerId)?.name || 'Unknown';

      console.log(`[DEBUG] Player ${playerName} (${playerId}) is passing in round ${room.round}`);
      console.log(`[DEBUG] Current passes before: [${room.passes.join(', ')}]`);

      if (!room.passes.includes(playerId)) {
        room.passes.push(playerId);
        console.log(`[DEBUG] Added ${playerName} to passes. New passes: [${room.passes.join(', ')}]`);
      }

      // If all other players passed, start new round
      const activePlayers = room.players.filter(p => p.hand.length > 0);
      const passedPlayers = activePlayers.filter(p => room.passes.includes(p.id));

      console.log(`[DEBUG] Active players: ${activePlayers.length}, Passed players: ${passedPlayers.length}`);
      console.log(`[DEBUG] Active player IDs: [${activePlayers.map(p => p.id).join(', ')}]`);
      console.log(`[DEBUG] Passed player IDs: [${passedPlayers.map(p => p.id).join(', ')}]`);

      if (passedPlayers.length === activePlayers.length - 1) {
        // All players passed, start new round with the player who played last
        console.log(`[DEBUG] All players passed! Starting new round. Clearing passes array.`);
        room.currentCombination = null;
        room.passes = [];
        room.pile = []; // Clear the cards from the table
        room.round = (room.round || 1) + 1; // Increment round counter
        console.log(`[DEBUG] Round incremented to ${room.round}. Passes cleared: [${room.passes.join(', ')}]`);

        // Turn goes to the player who played the last card
        if (room.lastPlayer) {
          room.turn = room.lastPlayer;
          const lastPlayerName = room.players.find(p => p.id === room.lastPlayer)?.name || 'Unknown';
          console.log(`[DEBUG] Turn goes to last player: ${lastPlayerName} (${room.lastPlayer})`);

          // If the last player is a bot, make them move
          const lastPlayerObj = room.players.find(p => p.id === room.lastPlayer);
          if (lastPlayerObj && lastPlayerObj.isBot) {
            setTimeout(() => makeBotMove(room, lastPlayerObj, io), 1000);
          }
        }

        // Always emit game_update when turn changes, even for bots
        io.to(roomId).emit("game_update", room);
        return;
      } else {
        // Move to next player
        const currentIdx = room.players.findIndex(p => p.id === socket.id);
        const nextPlayerIdx = (currentIdx + 1) % room.players.length;
        const nextPlayer = room.players[nextPlayerIdx];

        // Skip players who have passed this round
        if (room.passes.includes(nextPlayer.id)) {
          console.log(`[DEBUG] Next player ${nextPlayer.name} has already passed this round, skipping...`);
          // Find the next player who hasn't passed
          let foundValidPlayer = false;
          for (let i = 1; i < room.players.length; i++) {
            const checkIdx = (currentIdx + i) % room.players.length;
            const checkPlayer = room.players[checkIdx];
            if (!room.passes.includes(checkPlayer.id)) {
              room.turn = checkPlayer.id;
              console.log(`[DEBUG] Found valid next player: ${checkPlayer.name} (${checkPlayer.id})`);
              foundValidPlayer = true;
              break;
            }
          }
          if (!foundValidPlayer) {
            console.log(`[DEBUG] ERROR: No valid players found to take turn!`);
          }
        } else {
          room.turn = nextPlayer.id;
          console.log(`[DEBUG] Turn moved to: ${nextPlayer.name} (${nextPlayer.id})`);
        }

        // If next player is a bot, make them move
        const nextPlayerObj = room.players.find(p => p.id === room.turn);
        if (nextPlayerObj && nextPlayerObj.isBot) {
          setTimeout(() => makeBotMove(room, nextPlayerObj, io), 1000);
        }
      }

      console.log(`[DEBUG] Final turn: ${room.players.find(p => p.id === room.turn)?.name} (${room.turn})`);
      console.log(`[DEBUG] Final passes: [${room.passes.join(', ')}]`);
      console.log(`[DEBUG] --- End of pass handler ---\n`);

      io.to(roomId).emit("game_update", room);
    });

    socket.on("disconnect", async () => {
      console.log(`User ${socket.id} disconnected`);

      // Remove from all rooms
      for (const [roomId, room] of rooms) {
        let roomChanged = false;

        // Ensure room properties are initialized
        if (!room.players) room.players = [];
        if (!room.viewers) room.viewers = [];
        if (!room.chairs) room.chairs = [null, null, null, null];

        // Remove from players if seated
        const playerIndex = room.players.findIndex(p => p.id === socket.id);
        if (playerIndex !== -1) {
          const player = room.players[playerIndex];
          if (player.chair !== null) {
            room.chairs[player.chair] = null;
          }
          room.players.splice(playerIndex, 1);
          roomChanged = true;
          console.log(`Removed player ${socket.id} from room ${roomId}`);
        }

        // Remove from viewers
        const viewerCountBefore = room.viewers.length;
        room.viewers = room.viewers.filter(v => v.id !== socket.id);
        if (viewerCountBefore !== room.viewers.length) {
          roomChanged = true;
          console.log(`Removed viewer ${socket.id} from room ${roomId}`);
        }

        // If room owner disconnected, assign new owner to first human player
        if (room.owner === socket.id) {
          const humanPlayers = room.players.filter(p => !p.isBot);
          if (humanPlayers.length > 0) {
            room.owner = humanPlayers[0].id;
            console.log(`Transferred ownership to ${humanPlayers[0].id} in room ${roomId}`);
          } else if (room.players.length > 0) {
            // If no human players, assign to first bot
            room.owner = room.players[0].id;
            console.log(`Transferred ownership to bot ${room.players[0].id} in room ${roomId}`);
          }
          // If no players at all, ownership remains with disconnected player
          // It will be restored when they reconnect
          roomChanged = true;
        }

        // Check if room is now empty and should be deleted
        const totalPlayers = room.players.length + room.viewers.length;
        if (totalPlayers === 0) {
          console.log(`Room ${roomId} is now empty, deleting from database`);
          await deleteRoomFromDB(roomId, supabase);
          rooms.delete(roomId); // Remove from memory
          continue; // Skip broadcasting updates for deleted room
        }

        // Save room changes to database
        if (roomChanged) {
          await saveRoomToDB(room, supabase);
          console.log(`Saved room changes for ${roomId} to database`);
        }

        // Broadcast room update to remaining players
        io.to(roomId).emit("room_update", room);
        console.log(`Broadcasted room update for ${roomId} with ${room.players.length} players and ${room.viewers.length} viewers`);
      }

      // Broadcast updated room list to all clients
      const roomsList = await getRoomsFromDB(supabase);
      io.emit("rooms_list", roomsList);
      console.log(`Broadcasted updated room list`);
    });
  });
}

export { setupSocketHandlers };