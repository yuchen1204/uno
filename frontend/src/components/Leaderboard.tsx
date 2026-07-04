import { useState, useEffect } from "react";
import { api } from "../api";
import { LeaderboardEntry } from "../types";

function getRankClass(index: number): string {
  if (index === 0) return "gold";
  if (index === 1) return "silver";
  if (index === 2) return "bronze";
  return "";
}

export default function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getLeaderboard(100)
      .then(res => setEntries(res.leaderboard))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">加载中...</div>;

  return (
    <div className="leaderboard">
      <h2>排行榜</h2>
      {entries.length === 0 ? (
        <p style={{ textAlign: "center", color: "#666" }}>暂无数据</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>排名</th>
              <th>玩家</th>
              <th>积分</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e, i) => (
              <tr key={e.username}>
                <td className={`rank ${getRankClass(i)}`}>{i + 1}</td>
                <td>{e.username}</td>
                <td>{e.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
