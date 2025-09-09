import { getRoom } from './roomManager.js';
import { createCleanRoomData } from './roomHelpers.js';

function setupBotHandlers(io, supabase) {
  io.on("connection", (socket) => {
    socket.on("add_bot", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

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

      io.to(roomId).emit("room_update", createCleanRoomData(room));
    });

    socket.on("remove_bot", async (roomId) => {
      const room = await getRoom(roomId);
      if (!room) return; // Room might have been cleaned up

      // Ensure room properties are initialized
      if (!room.players) room.players = [];
      if (!room.chairs) room.chairs = [null, null, null, null];

      // Find and remove a bot
      const botIndex = room.players.findIndex(p => p.name.startsWith('Bot '));
      if (botIndex === -1) return;

      const bot = room.players[botIndex];
      room.players.splice(botIndex, 1);
      room.chairs[bot.chair] = null;

      io.to(roomId).emit("room_update", createCleanRoomData(room));
    });
  });
}

export { setupBotHandlers };