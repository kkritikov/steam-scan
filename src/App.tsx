import React, { useState, useEffect } from "react";
import axios from "axios";
import "./App.css";

type PlayerGame = {
  playerName: string;
  games: { appid: number; name: string; hours: number }[];
};

type AggregatedGame = {
  appid: number;
  name: string;
  totalHours: number;
  playerCount: number;
  averageHours: number;
};

const CORS_PROXY = "https://corsproxy.io/?";

type SortField = "hours" | "players" | "average";
type SortDirection = "asc" | "desc";

const GAMES_PER_PAGE = 20;
const MAX_PAGES = 10;
const API_KEY_STORAGE_KEY = "steamApiKey";

function App() {
  const [apiKey, setApiKey] = useState("");
  const [groupInput, setGroupInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [total, setTotal] = useState(0);
  const [log, setLog] = useState<string[]>([]);
  const [games, setGames] = useState<AggregatedGame[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>("hours");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState(1);
  const [darkMode, setDarkMode] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // Load API key from localStorage on component mount
  useEffect(() => {
    const savedApiKey = localStorage.getItem(API_KEY_STORAGE_KEY);
    if (savedApiKey) {
      setApiKey(savedApiKey);
    }
  }, []);

  const getGameIconUrl = (appid: number) =>
    `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`;

  const toggleDarkMode = () => {
    setDarkMode(!darkMode);
  };

  function extractGroupId(input: string): string {
    try {
      if (input.startsWith("http")) {
        const url = new URL(input);
        const parts = url.pathname.split("/").filter(Boolean);
        if (parts[0] === "groups" && parts[1]) return parts[1];
      }
      return input.trim();
    } catch {
      return input.trim();
    }
  }

  async function onStart() {
    // Abort previous request if exists
    if (abortController) {
      abortController.abort();
    }

    const newAbortController = new AbortController();
    setAbortController(newAbortController);

    setError(null);
    setGames([]);
    setLog([]);
    setProgress(0);
    setLoading(true);
    setSortField("hours");
    setSortDirection("desc");
    setCurrentPage(1);

    // Save API key to localStorage
    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);

    const groupId = extractGroupId(groupInput);
    if (!apiKey) {
      setError("Please enter Steam API key");
      setLoading(false);
      return;
    }
    if (!groupId) {
      setError("Please enter Steam group ID or URL");
      setLoading(false);
      return;
    }

    try {
      const res = await fetchGroupStats(groupId, apiKey, newAbortController);
      setGames(res);
    } catch (e) {
      if (!newAbortController.signal.aborted) {
        setError("Error loading data: " + (e as Error).message);
      }
    } finally {
      if (!newAbortController.signal.aborted) {
        setLoading(false);
        setAbortController(null);
      }
    }
  }

  async function fetchGroupStats(
    groupId: string,
    key: string,
    controller: AbortController
  ): Promise<AggregatedGame[]> {
    const allMembers = await getGroupMembers(groupId, controller);
    setTotal(allMembers.length);
    
    let collected: PlayerGame[] = [];
    let index = 0;
    const batchSize = 20;

    while (index < allMembers.length && !controller.signal.aborted) {
      const chunk = allMembers.slice(index, index + batchSize);
      index += batchSize;

      const results = await Promise.all(
        chunk.map(async (id) => {
          try {
            const data = await getOwnedGames(id, key, controller);
            if (data) {
              setLog((prev) => [...prev, `${data.playerName} — ${data.games.length} games`]);
              setProgress(index);
              return data;
            }
          } catch (e) {
            if (!controller.signal.aborted) {
              console.error(`Error processing user ${id}:`, e);
            }
          }
          return null;
        })
      );

      collected.push(...results.filter(Boolean) as PlayerGame[]);
    }

    if (controller.signal.aborted) {
      throw new Error("Request aborted");
    }

    return aggregateGames(collected);
  }

  async function getGroupMembers(
    groupId: string,
    controller: AbortController
  ): Promise<string[]> {
    const targetUrl = `https://steamcommunity.com/groups/${groupId}/memberslistxml/?xml=1`;
    try {
      const res = await axios.get(CORS_PROXY + encodeURIComponent(targetUrl), {
        signal: controller.signal
      });
      const text = res.data as string;

      const steamIDs = Array.from(text.matchAll(/<steamID64>(\d+)<\/steamID64>/g)).map(
        (m) => m[1]
      );
      return steamIDs;
    } catch (error) {
      if (!controller.signal.aborted) {
        throw new Error("Error fetching group members");
      }
      return [];
    }
  }

  async function getOwnedGames(
    steamId: string,
    key: string,
    controller: AbortController
  ): Promise<PlayerGame | null> {
    try {
      const profileUrl = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${key}&steamids=${steamId}`;
      const profileRes = await axios.get(CORS_PROXY + encodeURIComponent(profileUrl), {
        signal: controller.signal
      });
      const summary = profileRes.data.response.players?.[0];
      if (!summary || summary.communityvisibilitystate !== 3) return null;

      const personaname = summary.personaname || steamId;

      const gamesUrl = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${key}&steamid=${steamId}&include_appinfo=1&include_played_free_games=1`;
      const gamesRes = await axios.get(CORS_PROXY + encodeURIComponent(gamesUrl), {
        signal: controller.signal
      });
      const games = gamesRes.data.response.games || [];

      return {
        playerName: personaname,
        games: games.map((g: any) => ({
          appid: g.appid,
          name: g.name,
          hours: g.playtime_forever / 60,
        })),
      };
    } catch {
      return null;
    }
  }

  function aggregateGames(data: PlayerGame[]): AggregatedGame[] {
    const map = new Map<string, { 
      appid: number; 
      totalHours: number; 
      playerCount: number 
    }>();

    for (const player of data) {
      for (const game of player.games) {
        const g = map.get(game.name);
        if (g) {
          g.totalHours += game.hours;
          g.playerCount += 1;
        } else {
          map.set(game.name, {
            appid: game.appid,
            totalHours: game.hours,
            playerCount: 1,
          });
        }
      }
    }

    const gamesArray = Array.from(map.entries()).map(([name, { appid, totalHours, playerCount }]) => ({
      appid,
      name,
      totalHours,
      playerCount,
      averageHours: totalHours / playerCount,
    }));

    return gamesArray.sort((a, b) => b.totalHours - a.totalHours);
  }

  function sortGames(field: SortField) {
    let direction: SortDirection = "desc";
    if (sortField === field) {
      direction = sortDirection === "desc" ? "asc" : "desc";
    }
    setSortField(field);
    setSortDirection(direction);
    setCurrentPage(1);

    const sorted = [...games].sort((a, b) => {
      if (field === "hours") {
        return direction === "asc"
          ? a.totalHours - b.totalHours
          : b.totalHours - a.totalHours;
      } else if (field === "players") {
        return direction === "asc"
          ? a.playerCount - b.playerCount
          : b.playerCount - a.playerCount;
      } else {
        return direction === "asc"
          ? a.averageHours - b.averageHours
          : b.averageHours - a.averageHours;
      }
    });

    setGames(sorted);
  }

  const paginate = (pageNumber: number) => {
    setCurrentPage(pageNumber);
  };

  // Calculate pagination
  const indexOfLastGame = currentPage * GAMES_PER_PAGE;
  const indexOfFirstGame = indexOfLastGame - GAMES_PER_PAGE;
  const currentGames = games.slice(indexOfFirstGame, indexOfLastGame);
  const totalPages = Math.min(Math.ceil(games.length / GAMES_PER_PAGE), MAX_PAGES);

  return (
    <div className={`app-container ${darkMode ? "dark" : "light"}`}>
      <div className="container">
        <div className="header">
          <img 
            src="https://upload.wikimedia.org/wikipedia/commons/thumb/8/83/Steam_icon_logo.svg/640px-Steam_icon_logo.svg.png" 
            alt="Steam Logo" 
            className="steam-logo"
            style={{ width: '40px', height: '40px', marginRight: '10px' }}
          />
          <h1>Steam Group Games Analyzer</h1>
          <button className="theme-toggle" onClick={toggleDarkMode}>
            {darkMode ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>

        <div className="input-group">
          <input
            type="text"
            placeholder="Enter Steam API key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <input
            type="text"
            placeholder="Enter Steam group ID or URL"
            value={groupInput}
            onChange={(e) => setGroupInput(e.target.value)}
          />
          <button onClick={onStart} disabled={loading}>
            {loading ? "Loading..." : "Analyze"}
          </button>
        </div>

        {error && <div className="error">{error}</div>}

        {loading && (
          <div className="loading-container">
            <div className="progress-container">
              <progress value={progress} max={total} />
              <div>
                {progress} / {total} members processed
              </div>
            </div>
            <div className="log">
              {log.map((line, i) => (
                <div key={i} className="log-entry">
                  {line}
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && games.length > 0 && (
          <div className="results-container">
            <table className="games-table">
              <thead>
                <tr>
                  <th>Game</th>
                  <th onClick={() => sortGames("hours")} className="sortable">
                    Total Hours
                    {sortField === "hours" && (
                      <span className="arrow">
                        {sortDirection === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </th>
                  <th onClick={() => sortGames("average")} className="sortable">
                    Avg Hours
                    {sortField === "average" && (
                      <span className="arrow">
                        {sortDirection === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </th>
                  <th onClick={() => sortGames("players")} className="sortable">
                    Players
                    {sortField === "players" && (
                      <span className="arrow">
                        {sortDirection === "asc" ? "↑" : "↓"}
                      </span>
                    )}
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentGames.map((game, i) => (
                  <tr key={i} className="game-row">
                    <td className="name-cell">
                      <img
                        src={getGameIconUrl(game.appid)}
                        alt={game.name}
                        className="game-icon"
                        onError={(e) => {
                          (e.target as HTMLImageElement).src = "https://via.placeholder.com/48x27?text=No+Img";
                        }}
                      />
                      <span className="game-name">{game.name}</span>
                    </td>
                    <td>{game.totalHours.toFixed(1)}</td>
                    <td>{game.averageHours.toFixed(1)}</td>
                    <td>{game.playerCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {totalPages > 1 && (
              <div className="pagination">
                {currentPage > 1 && (
                  <button onClick={() => paginate(currentPage - 1)}>«</button>
                )}
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((number) => (
                  <button
                    key={number}
                    onClick={() => paginate(number)}
                    className={currentPage === number ? "active" : ""}
                  >
                    {number}
                  </button>
                ))}
                {currentPage < totalPages && (
                  <button onClick={() => paginate(currentPage + 1)}>»</button>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;