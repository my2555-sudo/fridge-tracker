import { useEffect, useMemo, useState } from 'react';
import { daysLeft } from '../utils/shelfLife';
import { isExpired } from '../utils/dates';

async function fetchMealsByI(csv) {
  const res = await fetch(
    `https://www.themealdb.com/api/json/v1/1/filter.php?i=${encodeURIComponent(csv)}`
  );
  if (!res.ok) throw new Error('MealDB request failed');
  const j = await res.json();
  return j.meals || [];
}

function uniqById(list) {
  const m = new Map();
  for (const x of list) m.set(x.idMeal, x);
  return [...m.values()];
}

// ✅ 只从“可用原料”里挑（未过期 + 在库）
function pickPriorityIngredients(items) {
  // 可用：未过期、且状态为 in（排除 consumed/discarded）
  const alive = items.filter(
    (i) => !isExpired(i) && ((i.status ?? 'in') === 'in')
  );

  // 紧迫度排序：先 ≤2 天，再 3–5 天，最后 >5 天
  const byUrgency = [
    ...alive.filter((i) => daysLeft(i.expiryISO) <= 2),
    ...alive.filter((i) => {
      const d = daysLeft(i.expiryISO);
      return d > 2 && d <= 5;
    }),
    ...alive.filter((i) => daysLeft(i.expiryISO) > 5),
  ];

  // 去重（按名称），最多挑 3 个关键词
  const seen = new Set();
  const out = [];
  for (const it of byUrgency) {
    const k = (it.name || '').trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(it.name.trim());
    if (out.length >= 3) break;
  }
  return out;
}

export default function RecipeSuggestions({ items = [], onCountChange }) {
  const [recipes, setRecipes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // ✅ 统计排除数量（过期或非 in 状态）
  const aliveCount = items.filter(
    (i) => !isExpired(i) && ((i.status ?? 'in') === 'in')
  ).length;
  const dropped = items.length - aliveCount;

  // ✅ 仅基于可用原料生成关键词
  const ing = useMemo(() => pickPriorityIngredients(items), [items]);
  const ingCsv = ing.join(',');

  useEffect(() => {
    (async () => {
      if (!ing.length) {
        setRecipes([]);
        onCountChange?.(0);
        return;
      }
      setLoading(true);
      setErr('');
      try {
        // 1) 全部一起
        let all = await fetchMealsByI(ingCsv);

        // 2) 没结果 → 尝试任意两两组合
        if (!all.length && ing.length >= 2) {
          for (let i = 0; i < ing.length; i++) {
            for (let j = i + 1; j < ing.length; j++) {
              const part = await fetchMealsByI(`${ing[i]},${ing[j]}`);
              all = all.concat(part);
            }
          }
        }

        // 3) 还没有 → 单个食材，各取一些
        if (!all.length) {
          for (const one of ing) {
            const part = await fetchMealsByI(one);
            all = all.concat(part.slice(0, 6));
          }
        }

        // 合并去重，并按“命中食材数量”降序
        const uniq = uniqById(all)
          .map((m) => {
            const name = (m.strMeal || '').toLowerCase();
            const hits = ing.reduce(
              (acc, x) => acc + (name.includes(x.toLowerCase()) ? 1 : 0),
              0
            );
            return { ...m, __hits: hits };
          })
          .sort((a, b) => b.__hits - a.__hits);

        setRecipes(uniq.slice(0, 6));
        onCountChange?.(uniq.length);
      } catch (e) {
        setErr(e.message || 'Failed to fetch recipes');
        setRecipes([]);
        onCountChange?.(0);
      } finally {
        setLoading(false);
      }
    })();
  }, [ingCsv]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ marginTop: 12 }}>
      <strong>🍽️ Recipe Suggestions</strong>
      <div style={{ color: '#6b7280', fontSize: 13, marginTop: 4 }}>
        Using ingredients: {ing.length ? ing.join(', ') : '—'}
      </div>
      {dropped > 0 && (
        <div style={{ color: '#9ca3af', fontSize: 12, marginTop: 2 }}>
          {dropped} expired or unavailable item{dropped > 1 ? 's' : ''} excluded
        </div>
      )}

      {loading && <div style={{ marginTop: 8 }}>Loading recipes…</div>}
      {err && <div style={{ color: '#c00', marginTop: 8 }}>Error: {err}</div>}
      {!loading && !err && !recipes.length && (
        <div style={{ color: '#777', marginTop: 8 }}>
          No recipe suggestions yet.
        </div>
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))',
          gap: 12,
          marginTop: 12,
        }}
      >
        {recipes.map((r) => (
          <a
            key={r.idMeal}
            href={`https://www.themealdb.com/meal/${r.idMeal}`}
            target="_blank"
            rel="noreferrer"
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 12,
              padding: 8,
              textDecoration: 'none',
              color: '#111',
              background: '#fff',
            }}
          >
            <img
              src={r.strMealThumb}
              alt={r.strMeal}
              style={{
                width: '100%',
                borderRadius: 8,
                aspectRatio: '4/3',
                objectFit: 'cover',
              }}
            />
            <div style={{ fontWeight: 600, marginTop: 6 }}>{r.strMeal}</div>
          </a>
        ))}
      </div>
    </div>
  );
}
