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

    // Get connected socket IDs for better tracking
    const connectedSocketIds = [];
    room.players.forEach(p => {
      if (p.connected) connectedSocketIds.push(p.id);
    });

    // Prepare seats data for database
    const seatsData = room.chairs.map((chairPlayerId, index) => {
      if (chairPlayerId) {
        const player = room.players.find(p => p.id === chairPlayerId);
        return {
          playerId: player ? player.id : null,
          userId: player ? player.userId : null,
          name: player ? player.name : null,
          connected: player ? player.connected : false,
          ready: player ? player.ready : false
        };
      }
      return {
        playerId: null,
        userId: null,
        name: null,
        connected: false,
        ready: false
      };
    });

    const upsertData = {
      room_id: room.id,
      room_name: room.name,
      current_players: room.players.filter(p => p.connected).length,
      active_connections: connectedSocketIds.length,
      seats: seatsData,
      connected_socket_ids: connectedSocketIds,
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
      last_activity: new Date().toISOString()
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
      // Return default rooms if database error
      return getDefaultRooms();
    }

    if (!data || data.length === 0) {
      console.log('No rooms found in database, returning default rooms');
      return getDefaultRooms();
    }

    console.log('Successfully loaded rooms list from database:', data.length, 'rooms');
    return data.map(room => ({
      id: room.room_id,
      owner: room.room_owner_id,
      playerCount: room.current_players,
      gameStarted: room.game_started,
      created: new Date(room.created_at).getTime()
    }));
  } catch (err) {
    console.error('Error in getRoomsFromDB:', err);
    // Return default rooms if error
    return getDefaultRooms();
  }
}

function getDefaultRooms() {
  const defaultRooms = [];
  for (let i = 1; i <= 10; i++) {
    const roomId = `room_${i.toString().padStart(2, '0')}`;
    defaultRooms.push({
      id: roomId,
      owner: null,
      playerCount: 0,
      gameStarted: false,
      created: Date.now()
    });
  }
  console.log('Returning default rooms:', defaultRooms.length);
  return defaultRooms;
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

async function initializeRooms(supabase) {
  try {
    console.log('Initializing Thirteen rooms...');

    // Check if rooms already exist
    const { data: existingRooms, error: checkError } = await supabase
      .from('thirteen_rooms')
      .select('room_id')
      .limit(1);

    if (checkError && checkError.code !== 'PGRST116') {
      console.error('Error checking for existing rooms:', checkError);
      return;
    }

    if (existingRooms && existingRooms.length > 0) {
      console.log('Rooms already exist, skipping initialization');
      return;
    }

    // Create the 10 rooms
    const roomsToCreate = [];
    for (let i = 1; i <= 10; i++) {
      const roomId = `room_${i.toString().padStart(2, '0')}`;
      const roomName = `Room ${i}`;
      roomsToCreate.push({
        room_id: roomId,
        room_name: roomName,
        seats: [
          { playerId: null, userId: null, name: null, connected: false, ready: false },
          { playerId: null, userId: null, name: null, connected: false, ready: false },
          { playerId: null, userId: null, name: null, connected: false, ready: false },
          { playerId: null, userId: null, name: null, connected: false, ready: false }
        ]
      });
    }

    const { data, error } = await supabase
      .from('thirteen_rooms')
      .insert(roomsToCreate);

    if (error) {
      console.error('Error creating rooms:', error);
    } else {
      console.log(`Successfully created ${roomsToCreate.length} rooms`);
    }
  } catch (err) {
    console.error('Error in initializeRooms:', err);
  }
}

function setupSocketHandlers(io, supabase) {
  // Initialize rooms on server start
  initializeRooms(supabase);

  // Inject the database loader function
  setDatabaseLoader((roomId) => loadRoomFromDB(roomId, supabase));

  // Improved periodic cleanup of empty rooms (every 2 minutes)
  setInterval(async () => {
    console.log('Running periodic room cleanup...');
    const now = Date.now();

    for (const [roomId, room] of rooms) {
      const totalPlayers = room.players.length + room.viewers.length;

      // Clean up rooms with no players immediately
      if (totalPlayers === 0) {
        console.log(`Cleaning up empty room: ${roomId}`);
        await deleteRoomFromDB(roomId, supabase);
        rooms.delete(roomId);
        continue;
      }

      // Clean up rooms that have been inactive for more than 10 minutes
      const lastActivity = room.lastActivity || room.created;
      const inactiveTime = now - lastActivity;
      if (inactiveTime > 10 * 60 * 1000) { // 10 minutes
        console.log(`Cleaning up inactive room: ${roomId} (${Math.round(inactiveTime / 60000)} minutes inactive)`);
        await deleteRoomFromDB(roomId, supabase);
        rooms.delete(roomId);
        continue;
      }

      // Update room activity in database if there are active players
      if (totalPlayers > 0) {
        try {
          await supabase
            .from('thirteen_rooms')
            .update({
              last_activity: new Date().toISOString(),
              active_connections: totalPlayers
            })
            .eq('room_id', roomId);
        } catch (error) {
          console.error(`Failed to update activity for room ${roomId}:`, error);
        }
      }
    }

    // Also clean up database entries that have no active connections
    try {
      const { data: inactiveRooms } = await supabase
        .from('thirteen_rooms')
        .select('room_id')
        .eq('is_active', true)
        .lt('last_activity', new Date(Date.now() - 15 * 60 * 1000).toISOString()) // 15 minutes ago
        .eq('active_connections', 0);

      if (inactiveRooms && inactiveRooms.length > 0) {
        console.log(`Found ${inactiveRooms.length} inactive rooms in database to clean up`);
        for (const dbRoom of inactiveRooms) {
          await deleteRoomFromDB(dbRoom.room_id, supabase);
        }
      }
    } catch (error) {
      console.error('Error during database cleanup:', error);
    }
  }, 2 * 60 * 1000); // 2 minutes

  io.on("connection", (socket) => {
    console.log("Connected:", socket.id);

    socket.on("get_rooms", async () => {
      const roomsList = await getRoomsFromDB(supabase);
      socket.emit("rooms_list", roomsList);
    });

    // Removed create_room handler - rooms are pre-created

    socket.on("join_room", async (roomId, name, userId) => {
      try {
        // Load room from database first
        let dbRoom = await loadRoomFromDB(roomId, supabase);
        if (!dbRoom) {
          console.log(`Room ${roomId} not found in database, creating it...`);
          // Create room if it doesn't exist
          const roomName = `Room ${roomId.split('_')[1] || roomId}`;
          const { data, error } = await supabase
            .from('thirteen_rooms')
            .insert({
              room_id: roomId,
              room_name: roomName,
              seats: [
                { playerId: null, userId: null, name: null, connected: false, ready: false },
                { playerId: null, userId: null, name: null, connected: false, ready: false },
                { playerId: null, userId: null, name: null, connected: false, ready: false },
                { playerId: null, userId: null, name: null, connected: false, ready: false }
              ]
            })
            .select()
            .single();

          if (error) {
            console.error('Error creating room:', error);
            socket.emit("error", "Failed to create room");
            return;
          }

          dbRoom = data;
          console.log(`Created new room: ${roomId}`);
        }

        // Get or create room in memory
        let room = await getRoom(roomId);
        if (!room) {
          // Create room from database data
          room = {
            id: dbRoom.room_id,
            name: dbRoom.room_name,
            players: [],
            viewers: [],
            chairs: [null, null, null, null],
            pile: [],
            turn: null,
            currentCombination: null,
            gameStarted: dbRoom.game_started,
            winner: null,
            passes: [],
            lastPlayer: null,
            deckShuffled: false,
            round: 1,
            created: Date.now(),
            lastActivity: Date.now()
          };

          // Load seats from database
          if (dbRoom.seats) {
            room.players = [];
            room.chairs = [null, null, null, null];

            dbRoom.seats.forEach((seat, index) => {
              if (seat.playerId) {
                room.players.push({
                  id: seat.playerId,
                  userId: seat.userId,
                  name: seat.name,
                  hand: [],
                  connected: seat.connected,
                  chair: index,
                  ready: seat.ready,
                  isBot: false
                });
                room.chairs[index] = seat.playerId;
              }
            });
          }

          // Load game state from database
          if (dbRoom.game_state) {
            const gameState = dbRoom.game_state;
            room.pile = gameState.pile || [];
            room.currentCombination = gameState.currentCombination;
            room.turn = gameState.turn;
            room.passes = gameState.passes || [];
            room.lastPlayer = gameState.lastPlayer;
            room.winner = gameState.winner;
            room.round = gameState.round || 1;
            room.deckShuffled = gameState.deckShuffled || false;
          }

          rooms.set(roomId, room);
        }

        socket.join(roomId);

        // Use authenticated user UUID if available
        const authenticatedUserId = userId && userId !== socket.id ? userId : null;

        // Check if player is already in a seat (reconnecting)
        let seatIndex = -1;
        let isReconnecting = false;

        if (authenticatedUserId) {
          // Try to find by userId first
          seatIndex = room.players.findIndex(p => p.userId === authenticatedUserId);
          if (seatIndex !== -1) {
            isReconnecting = true;
          }
        }

        if (!isReconnecting) {
          // Try to find by socket ID
          seatIndex = room.players.findIndex(p => p.id === socket.id);
          if (seatIndex !== -1) {
            isReconnecting = true;
          }
        }

        if (isReconnecting) {
          // Reconnecting to existing seat
          room.players[seatIndex].connected = true;
          room.players[seatIndex].id = socket.id; // Update socket ID
        } else {
          // Find empty seat
          seatIndex = room.chairs.findIndex(chair => chair === null);
          if (seatIndex === -1) {
            socket.emit("error", "All seats are occupied");
            return;
          }

          // Take the seat
          room.players.push({
            id: socket.id,
            userId: authenticatedUserId,
            name: name,
            hand: [],
            connected: true,
            chair: seatIndex,
            ready: false,
            isBot: false
          });
          room.chairs[seatIndex] = socket.id;
        }

        // Save updated room to database
        await saveRoomToDB(room, supabase);

        // Broadcast room update
        io.to(roomId).emit("room_update", room);
        socket.emit("room_joined", room);

        // Broadcast updated room list
        const roomsList = await getRoomsFromDB(supabase);
        io.emit("rooms_list", roomsList);

      } catch (error) {
        console.error('Error in join_room handler:', error);
        socket.emit("error", "Failed to join room");
      }
    });

    socket.on("sit_chair", async (roomId, chairIndex) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up
      if (chairIndex < 0 || chairIndex >= 4) return;

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

      // Reset countdown when someone joins a seat
      if (room.countdownInterval) {
        clearInterval(room.countdownInterval);
        room.countdownInterval = null;
      }
      room.countdownTime = null;

      // Save to database
      await saveRoomToDB(room, supabase);

      // Update profile pictures for players
      await updatePlayerProfilePics(room, supabase);

      io.to(roomId).emit("room_update", room);
    });

    socket.on("stand_up", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

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

      // Reset countdown when someone leaves a seat
      if (room.countdownInterval) {
        clearInterval(room.countdownInterval);
        room.countdownInterval = null;
      }
      room.countdownTime = null;

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
      if (!room) return; // Room might have been cleaned up

      // Ensure room properties are initialized
      if (!room.players) room.players = [];

      const player = room.players.find(p => p.id === socket.id);
      if (!player) return;

      // Toggle ready status
      player.ready = !player.ready;

      // Reset countdown when someone toggles ready (on or off)
      if (room.countdownInterval) {
        clearInterval(room.countdownInterval);
        room.countdownInterval = null;
      }
      room.countdownTime = null;

      // Check if all seated players are ready and connected
      const seatedPlayers = room.players.filter(p => p.chair !== null && p.connected);
      const allReady = seatedPlayers.length >= 2 && seatedPlayers.every(p => p.ready);

      if (allReady && !room.gameStarted) {
        // Start 6-second countdown
        room.countdownTime = 6;

        // Emit initial countdown
        io.to(roomId).emit("countdown_update", room.countdownTime);

        room.countdownInterval = setInterval(() => {
          room.countdownTime--;

          if (room.countdownTime <= 0) {
            // Time's up - start the game
            clearInterval(room.countdownInterval);
            room.countdownInterval = null;
            room.countdownTime = null;

            // Start game logic (same as before)
            room.gameStarted = true;
            room.pile = [];
            room.currentCombination = null;
            room.winner = null;
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

            io.to(roomId).emit("game_started", room);
          } else {
            // Emit countdown update
            io.to(roomId).emit("countdown_update", room.countdownTime);
          }
        }, 1000);
      }

      io.to(roomId).emit("room_update", room);
    });

    socket.on("add_bot", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

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
      if (!room) return; // Room might have been cleaned up

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
      io.to(roomId).emit("game_restarted", room);

      // Small delay before emitting game_started to allow client to process restart
      setTimeout(() => {
        io.to(roomId).emit("game_started", room);
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

      io.to(roomId).emit("cards_dealt", room);

      // If first player is a bot, make them move after a delay
      const firstPlayer = room.players.find(p => p.id === room.turn);
      if (firstPlayer && firstPlayer.isBot) {
        setTimeout(() => makeBotMove(room, firstPlayer, io), 1000);
      }
    });

    socket.on("play_cards", async ({ roomId, cards }) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up
      if (!room.gameStarted) return;

      const player = room.players.find(p => p.id === socket.id);
      if (!player || room.turn !== socket.id) return;

      // Validate the combination
      const combination = validateCombination(cards);
      if (!combination) {
        return; // Invalid combination
      }

      // Check if it can beat the current combination
      if (!canBeatCombination(combination, room.currentCombination)) {
        return;
      }

      // Check if player has all the cards
      const hasAllCards = cards.every(card => player.hand.includes(card));
      if (!hasAllCards) {
        return;
      }

      // Remove played cards from hand
      player.hand = player.hand.filter(c => !cards.includes(c));
      room.pile = cards;
      room.currentCombination = combination;
      // Don't reset passes here - only reset when a new round actually starts
      room.lastPlayer = player.id; // Track who played last

      // Check if player won
      if (player.hand.length === 0) {
        room.winner = player.id;
        room.winnerLastCards = cards; // Store the winning cards
        room.gameStarted = false;
      } else {
        // Move to next player
        const currentIdx = room.players.findIndex(p => p.id === socket.id);
        const nextPlayerIdx = (currentIdx + 1) % room.players.length;
        const nextPlayer = room.players[nextPlayerIdx];

        // Skip players who have passed this round
        if (room.passes.includes(nextPlayer.id)) {
          // Find the next player who hasn't passed
          let foundValidPlayer = false;
          for (let i = 1; i < room.players.length; i++) {
            const checkIdx = (currentIdx + i) % room.players.length;
            const checkPlayer = room.players[checkIdx];
            if (!room.passes.includes(checkPlayer.id)) {
              room.turn = checkPlayer.id;
              foundValidPlayer = true;
              break;
            }
          }
        } else {
          room.turn = nextPlayer.id;
        }

        // If next player is a bot, make them move
        const nextPlayerObj = room.players.find(p => p.id === room.turn);
        if (nextPlayerObj && nextPlayerObj.isBot) {
          setTimeout(() => makeBotMove(room, nextPlayerObj, io), 1000);
        }
      }

      io.to(roomId).emit("game_update", room);
    });

    socket.on("pass", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up
      if (!room.gameStarted || room.turn !== socket.id) return;

      const playerId = socket.id;

      if (!room.passes.includes(playerId)) {
        room.passes.push(playerId);
      }

      // If all other players passed, start new round
      const activePlayers = room.players.filter(p => p.hand.length > 0);
      const passedPlayers = activePlayers.filter(p => room.passes.includes(p.id));

      if (passedPlayers.length === activePlayers.length - 1) {
        // All players passed, start new round with the player who played the last card
        room.currentCombination = null;
        room.passes = [];
        room.pile = []; // Clear the cards from the table
        room.round = (room.round || 1) + 1; // Increment round counter

        // Turn goes to the player who played the last card
        if (room.lastPlayer) {
          room.turn = room.lastPlayer;

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
          // Find the next player who hasn't passed
          let foundValidPlayer = false;
          for (let i = 1; i < room.players.length; i++) {
            const checkIdx = (currentIdx + i) % room.players.length;
            const checkPlayer = room.players[checkIdx];
            if (!room.passes.includes(checkPlayer.id)) {
              room.turn = checkPlayer.id;
              foundValidPlayer = true;
              break;
            }
          }
        } else {
          room.turn = nextPlayer.id;
        }

        // If next player is a bot, make them move
        const nextPlayerObj = room.players.find(p => p.id === room.turn);
        if (nextPlayerObj && nextPlayerObj.isBot) {
          setTimeout(() => makeBotMove(room, nextPlayerObj, io), 1000);
        }
      }

      io.to(roomId).emit("game_update", room);
    });

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
                io.to(roomId).emit("game_update", room);
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
        io.to(roomId).emit("room_update", room);
        console.log(`Broadcasted room update for ${roomId}`);
      }

      // Broadcast updated room list
      const roomsList = await getRoomsFromDB(supabase);
      io.emit("rooms_list", roomsList);
      console.log(`Broadcasted updated room list`);
    });
  });
}

export { setupSocketHandlers };