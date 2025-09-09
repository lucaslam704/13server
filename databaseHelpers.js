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

    // If room.owner is undefined or a socket ID, try to find the first human player as owner
    if (!roomOwnerId || roomOwnerId.startsWith('socket_') || roomOwnerId.length < 20) {
      if (room.players && room.players.length > 0) {
        // Find first human player (not a bot)
        const humanPlayer = room.players.find(p => !p.isBot && p.userId);
        if (humanPlayer) {
          roomOwnerId = humanPlayer.userId;
          room.owner = roomOwnerId; // Update room owner
        } else {
          // If no human players, use first player's userId or socket ID as fallback
          const firstPlayer = room.players[0];
          if (firstPlayer) {
            roomOwnerId = firstPlayer.userId || firstPlayer.id;
            room.owner = roomOwnerId;
          }
        }
      }
    }

    // If we still don't have a valid owner, skip database operation but don't fail
    if (!roomOwnerId) {
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

export { saveRoomToDB, loadRoomFromDB, deleteRoomFromDB, getRoomsFromDB, getDefaultRooms };