import { useMemo } from 'react';
import { ArrowRight, X } from 'lucide-react';
import { DEMO_STEPS, type DemoResult, type DemoStep } from '../lib/demonstration';
import { bottleneck, STAGE_LABELS } from '../lib/decision-review';
import { timeLabel } from '../lib/format';
import ScenarioComparison from './scenario-comparison';

export default function DemonstrationRoute({ result, busy, onStep, onClose, onSave, saving, canSave }: {
  result: DemoResult | null; busy: boolean; onStep: (step: DemoStep) => void; onClose: () => void;
  onSave: () => void; saving: boolean; canSave: boolean;
}) {
  const index = DEMO_STEPS.findIndex(s => s.id === result?.step);
  const queue = useMemo(() => result ? bottleneck(result.simulation) : null, [result]);
  const explanation = !result ? 'Четыре шага на текущем наборе данных. Параметры каждого шага рассчитываются заново.'
    : result.step === 'baseline' ? 'Базовая мощность: 3 поста налива и 1 ресурс оформления. Далее найдём причину ожидания.'
    : result.step === 'bottleneck' ? queue?.stage
      ? `${STAGE_LABELS[queue.stage]}: ${(queue.minutes / 60).toLocaleString('ru-RU', { maximumFractionDigits: 1 })} маш.-ч ожидания за смену. Сцена открыта на общем пике очередей — ${timeLabel(result.focusTime)}.`
      : 'В этой смене ожидания нет. Можно проверить другой спрос или перейти к сравнению мощности.'
    : result.step === 'alternative' ? '6 постов, 2 ресурса оформления, очередь по сроку. На сцене — одна смена с seed 42; в таблице — средние за 30 смен.'
    : 'Первый пост недоступен одинаковое время в обоих вариантах. Сцена открыта во время сбоя; таблица показывает результаты полных смен.';
  return <section className="demo-route panel" aria-label="Демонстрация решения">
    <div className="demo-route-heading"><div><small>ПРОВЕРКА РЕШЕНИЯ</small><h2>От очереди к проверенному сценарию</h2></div><button className="icon-button" aria-label="Закрыть демонстрацию" onClick={onClose}><X size={18}/></button></div>
    <nav className="demo-route-steps" aria-label="Шаги демонстрации">{DEMO_STEPS.map((step, i) => <button key={step.id} disabled={busy} aria-current={result?.step === step.id ? 'step' : undefined} onClick={() => onStep(step.id)}><span>{i + 1}</span>{step.label}</button>)}</nav>
    <div className="demo-route-context"><p>{explanation}</p>{index < DEMO_STEPS.length - 1 && <button className="button small primary" disabled={busy} onClick={() => onStep(DEMO_STEPS[index + 1].id)}>{index < 0 ? 'Начать' : 'Следующий шаг'}<ArrowRight size={15}/></button>}</div>
    {result?.comparison && <ScenarioComparison result={result.comparison}/>}
    {result && <div className="demo-route-actions"><span>Текущий набор данных · seed 42</span><button className="button small" disabled={busy || saving || !canSave} onClick={onSave}>{saving ? 'Сохранение…' : 'Сохранить показанную смену'}</button></div>}
  </section>;
}
