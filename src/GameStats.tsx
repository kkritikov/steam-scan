import React from "react";

interface Props {
  gameStats: [string, number][];
}

export const GameStats: React.FC<Props> = ({ gameStats }) => {
  return (
    <div>
      <h2>🏆 Топ игр</h2>
      <ul>
        {gameStats.map(([name, hours], idx) => (
          <li key={idx}>{name}: {hours.toFixed(1)} ч</li>
        ))}
      </ul>
    </div>
  );
};
