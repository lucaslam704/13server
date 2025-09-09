// Room management utilities with database integration
const rooms = new Map(); // Store multiple rooms in memory

function createRoom(roomId, ownerId, ownerName) {
  const room = {
    id: roomId,
    owner: ownerId,
    name: ownerName, // Add the room name
    players: [], // {id, name, hand: [], connected: boolean, chair: number | null, ready: boolean}
    viewers: [], // {id, name}
    chairs: [null, null, null, null], // 4 chairs, null means empty
    pile: [],
    turn: null,
    currentCombination: null,
    gameStarted: false,
    winner: null,
    passes: [], // Players who passed this round
    lastPlayer: null, // Player who played the last card
    round: 1, // Current round number
    created: Date.now()
  };

  return room;
}

async function getRoom(roomId) {
  // First check in-memory cache
  let room = rooms.get(roomId);
  if (room) {
    return room;
  }

  // If not in memory, try to load from database
  try {
    const dbRoom = await loadRoomFromDB(roomId);
    if (dbRoom) {
      // Reconstruct room object from database data
      room = {
        id: dbRoom.room_id,
        owner: dbRoom.room_owner_id, // This is now a user UUID from the database
        name: dbRoom.room_name || 'Unnamed Room',
        players: [], // Will be populated as players reconnect with their user UUIDs
        viewers: [], // Will be populated as viewers reconnect with their user UUIDs
        chairs: [null, null, null, null], // Initialize chairs as empty
        pile: dbRoom.game_state?.pile || [],
        turn: dbRoom.game_state?.turn || null,
        currentCombination: dbRoom.game_state?.currentCombination || null,
        gameStarted: dbRoom.game_started || false,
        winner: dbRoom.winner_id || null,
        passes: dbRoom.game_state?.passes || [],
        lastPlayer: dbRoom.game_state?.lastPlayer || null,
        round: dbRoom.game_state?.round || 1,
        created: new Date(dbRoom.created_at).getTime()
      };

      // Note: We don't reconstruct players/viewers from DB here because:
      // 1. The database stores user UUIDs, but we need socket connections
      // 2. Players will reconnect and restore their state via socket events
      // 3. This ensures we always have the correct socket-to-user mapping

      rooms.set(roomId, room);
      return room;
    }
  } catch (error) {
    console.error('Error loading room from DB:', error);
  }

  return null;
}

async function getOrCreateRoom(roomId, playerId, playerName) {
  let room = await getRoom(roomId);

  if (!room) {
    room = createRoom(roomId, playerId, playerName);
    rooms.set(roomId, room);
  }

  return room;
}

// Helper function to load room from database (will be injected by socket handlers)
let loadRoomFromDB = null;
function setDatabaseLoader(loaderFunction) {
  loadRoomFromDB = loaderFunction;
}

// Randomly select starting player (spinning arrow equivalent)
function getStartingPlayerForRoom(room) {
  if (room.players.length === 0) return null;
  const randomIndex = Math.floor(Math.random() * room.players.length);
  return room.players[randomIndex].id;
}

export {
  rooms,
  createRoom,
  getRoom,
  getOrCreateRoom,
  getStartingPlayerForRoom,
  setDatabaseLoader
};