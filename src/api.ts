import axios from "axios";

const API_KEY = "E9FBFB77E90F3290646242C2A311C8B9";

export async function getGroupMembers(groupId: string): Promise<string[]> {
  const res = await axios.get(`https://steamcommunity.com/groups/${groupId}/memberslistxml/?xml=1`);
  const xml = res.data;
  const matches = [...xml.matchAll(/<steamID64>(\d+)<\/steamID64>/g)];
  return matches.map((m) => m[1]);
}

export async function getPlayerSummary(steamId: string) {
  const res = await axios.get(
    `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${API_KEY}&steamids=${steamId}`
  );
  const player = res.data.response.players[0];
  return player;
}

export async function getOwnedGames(steamId: string) {
  const res = await axios.get(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${API_KEY}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`
  );
  return res.data.response.games;
}
