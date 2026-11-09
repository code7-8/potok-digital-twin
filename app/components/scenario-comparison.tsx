import type { PairedComparison } from '../lib/engine/experiments';
import { POLICY_LABELS, scenarioChanges } from '../lib/decision-review';

const fmt = (n: number, digits = 1) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(n);
const metrics = [
  { key: 'shippedTonnes', label: 'Отгружено', unit: 'т', factor: 1, deltaUnit: 'т', lower: false },
  { key: 'serviceLevel', label: 'Выполнено в срок', unit: '%', factor: 100, deltaUnit: 'п.п.', lower: false },
  { key: 'meanWaitMinutes', label: 'Среднее ожидание', unit: 'мин', factor: 1, deltaUnit: 'мин', lower: true },
  { key: 'unfinishedOrders', label: 'Не завершено', unit: 'заявок', factor: 1, deltaUnit: 'заявок', lower: true },
  { key: 'totalCostRub', label: 'Модельные расходы', unit: 'тыс. ₽', factor: .001, deltaUnit: 'тыс. ₽', lower: true },
] as const;

export default function ScenarioComparison({ result, stale = false }: { result: PairedComparison; stale?: boolean }) {
  const { baseline, candidate, delta } = result;
  const changes = scenarioChanges(baseline.scenario, candidate.scenario);
  const fulfilled = candidate.samples.filter(s => s.metrics.serviceLevel >= .85).length;
  const noDemand = candidate.samples.every(s => s.metrics.demandOrders === 0);
  const targetMet = candidate.estimates.serviceLevel.mean >= .85;
  return <div className="decision-comparison" aria-label="Сравнение сценариев" data-stale={stale}>
    {stale && <p className="review-stale" role="status">Параметры или seed изменены. Ниже — предыдущее сравнение. Запустите сравнение заново.</p>}
    <div className="review-scenarios">
      {([['База', baseline], ['Альтернатива', candidate]] as const).map(([label, item]) => <div key={label}>
        <small>{label}</small><b>{item.scenario.name}</b>
        <span>{item.scenario.bayCount} постов · {item.scenario.dispatchCount} оформление · {POLICY_LABELS[item.scenario.policy]}</span>
        {item.scenario.outage && <span>Сбой поста {item.scenario.outage.bayIndex + 1}: {fmt(item.scenario.outage.durationMin)} мин</span>}
      </div>)}
    </div>
    <p className="review-caption">Средние за {candidate.seeds.length} парных смен · одинаковый спрос</p>
    <div className="table-scroll"><table className="review-table">
      <thead><tr><th>Показатель</th><th>База</th><th>Альтернатива</th><th>Изменение</th></tr></thead>
      <tbody>{metrics.map(({ key, label, unit, factor, deltaUnit, lower }) => {
        const d = delta[key];
        const better = lower ? d.ci95High < 0 : d.ci95Low > 0;
        const worse = lower ? d.ci95Low > 0 : d.ci95High < 0;
        return <tr key={key}><th scope="row">{label}<small>{unit}</small></th>
          <td>{fmt(baseline.estimates[key].mean * factor)}</td><td>{fmt(candidate.estimates[key].mean * factor)}</td>
          <td className={stale ? '' : better ? 'positive' : worse ? 'negative' : ''}>{d.mean > 1e-8 ? '+' : ''}{fmt(d.mean * factor)}<small>{deltaUnit}</small></td>
        </tr>;
      })}</tbody>
    </table></div>
    <div className={`review-verdict ${stale || noDemand ? '' : targetMet ? 'met' : 'unmet'}`}>
      <b>{noDemand ? 'В наборе нет заявок' : `Цель по среднему SLA: ${targetMet ? 'выполнена' : 'не достигнута'}`}</b>
      {!noDemand && <span>Порог 85% · достигнут в {fulfilled} из {candidate.samples.length} смен</span>}
    </div>
    <details className="review-details"><summary>Что изменено · {changes.length}</summary>
      {changes.length ? <dl>{changes.map((c, i) => <div key={`${c.key}-${i}`}><dt>{c.label}</dt><dd>{c.before} → <b>{c.after}</b></dd></div>)}</dl> : <p>Расчётные параметры совпадают.</p>}
    </details>
    <details className="review-details"><summary>Интервалы и разброс смен</summary>
      <p>95% интервал среднего эффекта «альтернатива − база». Цвет изменения появляется, только если интервал целиком по одну сторону нуля.</p>
      <dl>{metrics.map(({ key, label, factor, deltaUnit }) => <div key={key}><dt>{label}</dt><dd>{fmt(delta[key].ci95Low * factor)}…{fmt(delta[key].ci95High * factor)} {deltaUnit}</dd></div>)}</dl>
      <p>Разброс SLA альтернативы, P10–P90: {fmt(candidate.estimates.serviceLevel.p10 * 100)}–{fmt(candidate.estimates.serviceLevel.p90 * 100)}%. Порог 85% — условие демонстрации, не норматив предприятия.</p>
    </details>
    <p className="review-footnote">Расходы внутри синтетической модели, без капитальных вложений.</p>
  </div>;
}
