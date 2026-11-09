'use client';
import './terminal-scene.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, Box, Camera, Check, ChevronLeft, ChevronRight, CircleHelp, Crosshair, Expand, Warehouse, Eye, EyeOff, Focus, Gauge, Layers, Map, Moon, Pause, Play, Repeat2, RotateCcw, Route, Sun, Truck, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { SimulationResult } from '../lib/engine/types';
import { STATE_LABELS, orderStateAt } from '../lib/engine/projection';
import { bayStateAt, loadingProgress, MAX_TANKS, MAX_TRUCKS, nextEventTime, tankStockAt, terminalStats } from '../lib/terminal/playback';
import { POIS, poisFor, type Poi } from '../lib/terminal/pois';
import type { CameraView, SceneController, ViewState } from '../lib/terminal/renderer';
import { timeLabel } from '../lib/format';
export { POIS, poisFor, type Poi };

export interface PlaybackControls {
  playing: boolean; speed: number; loop: boolean;
  setSpeed: (speed: number) => void; setLoop: (loop: boolean) => void;
  seek: (time: number) => void; toggle: () => void;
}
const fmt = (n: number, digits = 0) => n.toLocaleString('ru-RU', { maximumFractionDigits: digits });
const bayLabels = { idle: 'Готов к наливу', loading: 'Налив', paused: 'Недоступен', closed: 'Резерв' };
const views: { id: CameraView; label: string; icon: typeof Box }[] = [
  { id: 'overview', label: 'Обзор', icon: Box }, { id: 'loading', label: 'Налив', icon: Gauge },
  { id: 'storage', label: 'Резервуары', icon: Layers }, { id: 'gate', label: 'Въезд', icon: Truck }, { id: 'plan', label: 'План', icon: Map },
];

export default function TerminalScene({ result, time, onSelect, controls, large = false }: {
  result: SimulationResult; time: number; onSelect: (poi: Poi) => void; controls: PlaybackControls; large?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null), host = useRef<HTMLDivElement>(null), controller = useRef<SceneController | null>(null);
  const [failed, setFailed] = useState(false), [ready, setReady] = useState(false), [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState<string | null>(null), [night, setNight] = useState(false), [labels, setLabels] = useState(true);
  const [roofs, setRoofs] = useState(true), [routes, setRoutes] = useState(false), [follow, setFollow] = useState(false), [orbit, setOrbit] = useState(false), [quality, setQuality] = useState<'auto' | 'high' | 'economy'>('auto');
  const [view, setView] = useState<CameraView>('overview'), [hover, setHover] = useState(''), [help, setHelp] = useState(false), [full, setFull] = useState(false);
  const state = useRef<ViewState>({ time, selected, night, labels, roofs, routes, follow, orbit, quality });
  useLayoutEffect(() => { state.current = { time, selected, night, labels, roofs, routes, follow, orbit, quality }; }, [time, selected, night, labels, roofs, routes, follow, orbit, quality]);
  const pois = useMemo(() => poisFor(result), [result]);
  const stats = terminalStats(result, time);
  const selectedOrder = result.orders.find(o => o.id === selected), selectedPoi = pois.find(p => p.id === selected);
  const events = result.events.filter(e => e.at <= time).slice(-5).reverse();
  const truckCount = result.orders.filter(o => o.arrivalMin <= time && (o.completedAt === undefined || time < o.completedAt + 4)).length;
  const tankCount = new Set(result.batches.map(b => b.tankId)).size;

  useEffect(() => {
    let cancelled = false, cleanup = () => {};
    import('../lib/terminal/renderer').then(({ createTerminalRenderer }) => {
      if (cancelled || !host.current) return;
      setFailed(false); setSelected(null); setFollow(false); setOrbit(false); setView('overview');
      const scene = createTerminalRenderer(host.current, result, () => state.current,
        id => { setSelected(id); setFollow(false); }, setHover, () => { setFailed(true); setReady(false); }, () => { setFollow(false); setOrbit(false); });
      controller.current = scene; cleanup = () => scene.dispose(); setReady(true);
    }).catch(error => { console.error('Terminal scene:', error); if (!cancelled) { setFailed(true); setReady(false); } });
    return () => { cancelled = true; cleanup(); controller.current = null; };
  }, [result, retry]);
  useEffect(() => {
    const change = () => setFull(document.fullscreenElement === root.current);
    document.addEventListener('fullscreenchange', change); return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  function camera(name: CameraView) { setView(name); setFollow(false); setOrbit(false); controller.current?.view(name); }
  async function fullscreen() {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await root.current?.requestFullscreen(); }
    catch { setHelp(true); }
  }
  const inspect = (id: string) => { setSelected(id); setFollow(false); };

  return <div ref={root} className={`terminal-experience ${large ? 'expanded' : 'compact'} ${full ? 'is-fullscreen' : ''}`}>
    <div className="terminal-topline"><div><span className={`terminal-live-dot ${controls.playing ? 'running' : ''}`} /><span>ТЕРМИНАЛ <b>01</b></span><span className="terminal-top-divider" /><small>{controls.playing ? 'ВОСПРОИЗВЕДЕНИЕ СМЕНЫ' : 'СНИМОК МОДЕЛИ'}</small></div><span className="terminal-model-badge"><Check size={12} /> Календарь расчёта · seed {result.seed}</span></div>
    <div className="terminal-metrics" aria-label="Состояние терминала на выбранный момент">
      <div><span>На наливе</span><b>{stats.loading}<small> / {result.scenario.bayCount}</small></b></div>
      <div className={stats.queue > 10 ? 'queue-warning' : ''}><span>В очередях</span><b>{stats.queue}<small> машин</small></b></div>
      <div><span>Отгружено</span><b>{fmt(stats.shippedTonnes)}<small> т</small></b></div>
      <div><span>Время модели</span><b>{timeLabel(time)}<small> / {timeLabel(result.horizonMin)}</small></b></div>
    </div>
    <div className="terminal-stage">
      <div className="terminal-viewport">
        <div className="terminal-canvas" ref={host} />
        {!ready && !failed && <div className="terminal-loading"><span /><strong>Собираем терминал</strong><small>Объекты, маршруты и календарь смены</small></div>}
        {failed && <div className="terminal-fallback"><Box size={30} /><strong>3D временно недоступно</strong><p>Состояния, события и управление временем работают в диспетчерской.</p><button onClick={() => setRetry(n => n + 1)}>Повторить загрузку 3D</button></div>}
        <div className="terminal-camera-bar" role="group" aria-label="Ракурсы камеры">{views.map(({ id, label, icon: Icon }, index) => <button key={id} aria-pressed={view === id && !follow} title={`${label} · клавиша ${index + 1}`} onClick={() => camera(id)}><Icon size={14} /><span>{label}</span></button>)}</div>
        <div className="terminal-view-tools">
          <button title={night ? 'Дневное освещение' : 'Ночное освещение'} aria-label={night ? 'Дневное освещение' : 'Ночное освещение'} aria-pressed={night} onClick={() => setNight(v => !v)}>{night ? <Moon size={17} /> : <Sun size={17} />}</button>
          <button title="Подписи объектов" aria-label="Подписи объектов" aria-pressed={labels} onClick={() => setLabels(v => !v)}>{labels ? <Eye size={17} /> : <EyeOff size={17} />}</button>
          <button title="Кровля эстакады" aria-label="Кровля эстакады" aria-pressed={roofs} onClick={() => setRoofs(v => !v)}><Warehouse size={17} /></button>
          <button title="Схема основного маршрута" aria-label="Схема основного маршрута" aria-pressed={routes} onClick={() => setRoutes(v => !v)}><Route size={17} /></button>
          <button title="Облёт терминала" aria-label="Облёт терминала" aria-pressed={orbit} onClick={() => { setOrbit(v => !v); setFollow(false); }}><Camera size={17} /></button>
          <span />
          <button title="Приблизить" aria-label="Приблизить" onClick={() => controller.current?.zoom(.8)}><ZoomIn size={17} /></button>
          <button title="Отдалить" aria-label="Отдалить" onClick={() => controller.current?.zoom(1.25)}><ZoomOut size={17} /></button>
          <button title="На весь экран" aria-label="На весь экран" aria-pressed={full} onClick={fullscreen}><Expand size={17} /></button>
        </div>
        <div className="terminal-compass" aria-hidden="true"><span>С</span><Crosshair size={25} /><small>УЧАСТОК 01</small></div>
        <div className="terminal-scene-caption"><span>{hover || (selectedOrder ? `Выбрана ${selectedOrder.id}` : 'Выберите объект или бензовоз')}</span><button onClick={() => setHelp(v => !v)} aria-label="Управление сценой"><CircleHelp size={14} /></button></div>
        {help && <div className="terminal-help"><button aria-label="Закрыть справку" onClick={() => setHelp(false)}><X size={16} /></button><b>Исследуйте терминал</b><p>Перетаскивание — вращение. Колесо или жест двумя пальцами — масштаб. Правая кнопка мыши — сдвиг.</p><p>Фокус на сцене: стрелки сдвигают камеру, клавиши 1–5 меняют ракурс. Все объекты доступны в списке справа.</p><p>Траектории условные. Они укладываются в интервалы операций и ожидания, не добавляя время в расчёт.</p></div>}
      </div>
      {(large || failed) && <aside className="terminal-inspector" aria-label="Диспетчерская терминала">
        <div className="terminal-inspector-heading"><span>{selected ? 'ВЫБРАННЫЙ ОБЪЕКТ' : 'ДИСПЕТЧЕРСКАЯ'}</span>{selected && <button aria-label="Снять выбор объекта" onClick={() => { setSelected(null); setFollow(false); }}><X size={15} /></button>}</div>
        <label className="terminal-object-select"><span className="sr-only">Выбрать объект</span><select aria-label="Выбрать объект" value={selected ?? ''} onChange={e => inspect(e.target.value)}><option value="">Все объекты терминала</option><optgroup label="Оборудование">{pois.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup><optgroup label="Бензовозы">{result.orders.filter(o => o.arrivalMin <= time).map(o => <option key={o.id} value={o.id}>{o.id} · {STATE_LABELS[orderStateAt(o, time, result)]}</option>)}</optgroup></select></label>
        {selectedOrder ? <div className="terminal-object-details">
          <div className="terminal-object-title"><Truck size={22} /><div><h3>{selectedOrder.id}</h3><span>{selectedOrder.product === 'diesel' ? 'Дизельное топливо' : 'Бензин АИ-95'} · {selectedOrder.tonnes} т</span></div></div>
          <div className={`terminal-state state-${orderStateAt(selectedOrder, time, result)}`}>{STATE_LABELS[orderStateAt(selectedOrder, time, result)]}</div>
          <dl><div><dt>Прибытие</dt><dd>{timeLabel(selectedOrder.arrivalMin)}</dd></div><div><dt>Срок заявки</dt><dd>{timeLabel(selectedOrder.dueMin)}</dd></div><div><dt>Пост налива</dt><dd>{selectedOrder.load && selectedOrder.load.start <= time ? selectedOrder.load.resourceId.replace('loading-', '№ ') : 'Ещё не назначен'}</dd></div><div><dt>Завершение</dt><dd>{selectedOrder.completedAt !== undefined && selectedOrder.completedAt <= time ? timeLabel(selectedOrder.completedAt) : 'В работе'}</dd></div></dl>
          {selectedOrder.load && selectedOrder.load.start <= time && <div className="terminal-operation"><span>Прогресс операции <b>{fmt(loadingProgress(selectedOrder, time, result) * 100)}%</b></span><div><i style={{ width: `${loadingProgress(selectedOrder, time, result) * 100}%` }} /></div><small>По активному времени, с учётом паузы</small></div>}
          <button className="terminal-follow" aria-pressed={follow} disabled={orderStateAt(selectedOrder, time, result) === 'completed' && time >= selectedOrder.completedAt! + 4} onClick={() => { setFollow(v => !v); setOrbit(false); }}><Focus size={16} />{follow ? 'Камера следует за машиной' : 'Следовать за машиной'}</button>
          <div className="terminal-order-stages">{[['Прибытие', selectedOrder.arrivalMin], ['Регистрация', selectedOrder.gate?.start], ['Налив', selectedOrder.load?.start], ['Оформление', selectedOrder.dispatch?.start], ['Выезд', selectedOrder.completedAt]].map(([label, at]) => <button key={label} disabled={typeof at !== 'number' || at > result.horizonMin} onClick={() => controls.seek(at as number)}><span>{label}</span><b>{typeof at === 'number' && at <= time ? timeLabel(at) : '→'}</b></button>)}</div>
        </div> : selectedPoi ? <ObjectInspector poi={selectedPoi} result={result} time={time} onDetails={() => onSelect(selectedPoi)} /> : <>
          <h3 className="terminal-section-title">Наливная эстакада <span>{result.scenario.bayCount} / 6</span></h3>
          <div className="terminal-bay-list">{Array.from({ length: 6 }, (_, index) => {
            const bay = bayStateAt(result, index, time);
            return <button key={index} disabled={index >= result.scenario.bayCount} onClick={() => inspect(`loading-${index + 1}`)} className={`bay-${bay.state}`}><span className="terminal-bay-number">{String(index + 1).padStart(2, '0')}</span><div><b>{bay.order?.id ?? bayLabels[bay.state]}</b><small>{bay.order ? `${bayLabels[bay.state]} · ${fmt(bay.progress * 100)}%` : index >= result.scenario.bayCount ? 'Не включён в сценарий' : 'Ожидание заявки'}</small></div><i /></button>;
          })}</div>
          <div className="terminal-queue-breakdown"><span>Регистрация <b>{stats.gateQueue}</b></span><span>Продукт / допуск <b>{stats.supplyWait}</b></span><span>Ожидание поста <b>{stats.loadingQueue}</b></span><span>Оформление <b>{stats.dispatchQueue}</b></span></div>
        </>}
        <div className="terminal-events"><h3 className="terminal-section-title">События смены <span>ПО МОДЕЛИ</span></h3>{events.length ? events.map((e, index) => <button key={`${e.at}-${index}-${e.entityId}`} onClick={() => { controls.seek(e.at); if (result.orders.some(o => o.id === e.entityId)) inspect(e.entityId); else if (e.resourceId?.startsWith('loading-')) inspect(e.resourceId); }}><time>{timeLabel(e.at)}</time><span><b>{e.entityId}</b>{eventLabel(e.type, e.stage)}</span></button>) : <p>Событий пока нет. Начните воспроизведение смены.</p>}</div>
      </aside>}
    </div>
    {!large && selected && <div className="terminal-compact-selection"><span>{selectedOrder ? `${selectedOrder.id} · ${STATE_LABELS[orderStateAt(selectedOrder, time, result)]}` : selectedPoi?.name}</span>{selectedPoi && <button onClick={() => onSelect(selectedPoi)}>Связь с моделью <ArrowUpRight size={13} /></button>}<button aria-label="Снять выбор" onClick={() => setSelected(null)}><X size={13} /></button></div>}
    <SimulationTimeline result={result} time={time} controls={controls} />
    <div className="terminal-footnote"><span><i /> Синтетическая смена · условная планировка{truckCount > MAX_TRUCKS || tankCount > MAX_TANKS ? ` · видно до ${MAX_TRUCKS} машин / ${MAX_TANKS} резервуаров; расчёт учитывает все` : ''}</span><label>Графика <select aria-label="Качество графики" value={quality} onChange={e => setQuality(e.target.value as 'auto' | 'high' | 'economy')}><option value="auto">Автоматически</option><option value="high">Детальная</option><option value="economy">Экономная</option></select></label></div>
  </div>;
}

function ObjectInspector({ poi, result, time, onDetails }: { poi: Poi; result: SimulationResult; time: number; onDetails: () => void }) {
  const bayIndex = poi.id.startsWith('loading-') ? Number(poi.id.split('-')[1]) - 1 : -1;
  const bay = bayIndex >= 0 ? bayStateAt(result, bayIndex, time) : null;
  const stock = poi.stage === 'supply' ? tankStockAt(result, poi.id, time) : null;
  const labActive = result.batches.filter(b => b.labStart !== null && b.labStart <= time && (b.releasedAt === null || b.releasedAt > time));
  const labReleased = result.batches.filter(b => b.releasedAt !== null && b.releasedAt <= time);
  return <div className="terminal-object-details"><div className="terminal-object-title"><Layers size={22} /><div><h3>{poi.name}</h3><span>{poi.id}</span></div></div>
    {bay && <><div className={`terminal-state state-${bay.state}`}>{bayLabels[bay.state]}</div><dl><div><dt>Текущая заявка</dt><dd>{bay.order?.id ?? '—'}</dd></div><div><dt>Продукт</dt><dd>{bay.order ? bay.order.product === 'diesel' ? 'ДТ' : 'АИ-95' : '—'}</dd></div><div><dt>Прогресс операции</dt><dd>{fmt(bay.progress * 100)}%</dd></div></dl>{bay.state === 'paused' && <p className="terminal-alert">Пост недоступен по сценарию. Прогресс операции остановлен; резерв продукта сохранён.</p>}</>}
    {stock && <><div className="terminal-state">{stock.available > 0 ? 'Есть допущенный запас' : 'Нет свободного допущенного запаса'}</div><dl><div><dt>Начальный запас</dt><dd>{fmt(stock.initial)} т</dd></div><div><dt>Нераспределённый</dt><dd>{fmt(stock.remaining)} т</dd></div><div><dt>Допущено и свободно</dt><dd>{fmt(stock.available)} т</dd></div><div><dt>Распределено заявкам</dt><dd>{fmt(stock.allocated)} т</dd></div></dl><p>Шкала на резервуаре показывает нераспределённый запас. Это учётная масса, а не уровень жидкости.</p></>}
    {poi.stage === 'lab' && <dl><div><dt>Партий на анализе</dt><dd>{labActive.length}</dd></div><div><dt>Партий выпущено</dt><dd>{labReleased.length} / {result.batches.length}</dd></div><div><dt>Допущено за смену к этому моменту</dt><dd>{fmt(labReleased.reduce((sum, b) => sum + b.tonnes, 0))} т</dd></div></dl>}
    {(poi.stage === 'gate' || poi.stage === 'dispatch') && <dl><div><dt>Активных ресурсов</dt><dd>{poi.stage === 'gate' ? result.scenario.gateCount : result.scenario.dispatchCount}</dd></div><div><dt>Занято сейчас</dt><dd>{result.orders.filter(o => orderStateAt(o, time, result) === poi.stage).length}</dd></div><div><dt>В очереди</dt><dd>{result.orders.filter(o => orderStateAt(o, time, result) === `${poi.stage}-queue`).length}</dd></div></dl>}
    <p>{poi.description}</p><button className="terminal-follow" onClick={onDetails}>Кейс и показатели смены <ArrowUpRight size={14} /></button>
  </div>;
}

function SimulationTimeline({ result, time, controls }: { result: SimulationResult; time: number; controls: PlaybackControls }) {
  const { playing, speed, loop, seek, toggle, setSpeed, setLoop } = controls;
  const milestones = useMemo(() => {
    const queue = (s: SimulationResult['snapshots'][number]) => s.gateQueue + s.supplyWait + s.loadingQueue + s.dispatchQueue;
    const peak = result.snapshots.reduce((best, s) => queue(s) > queue(best) ? s : best);
    const first = Math.min(...result.orders.map(o => o.arrivalMin));
    return [{ at: 0, label: 'Начало' }, ...(first <= result.horizonMin ? [{ at: first, label: 'Первый въезд' }] : []),
      ...(queue(peak) > 0 ? [{ at: peak.at, label: 'Пик очереди' }] : []),
      ...(result.scenario.outage ? [{ at: result.scenario.outage.startMin, label: 'Сбой поста' }] : []), { at: result.horizonMin, label: 'Итог смены' }].sort((a, b) => a.at - b.at);
  }, [result]);
  return <div className="terminal-timeline">
    <div className="terminal-timeline-row"><button className="terminal-play" onClick={toggle} aria-label={playing ? 'Приостановить' : 'Воспроизвести смену'}>{playing ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}</button><button aria-label="К началу смены" title="К началу смены" onClick={() => seek(0)}><RotateCcw size={15} /></button><button aria-label="Предыдущее событие" title="Предыдущее событие" disabled={time <= 0} onClick={() => seek(nextEventTime(result, time, -1))}><ChevronLeft size={18} /></button><button aria-label="Следующее событие" title="Следующее событие" disabled={time >= result.horizonMin} onClick={() => seek(nextEventTime(result, time, 1))}><ChevronRight size={18} /></button><b>{timeLabel(time)}</b><input aria-label="Время смены" type="range" min={0} max={result.horizonMin} step={.05} value={time} onChange={e => seek(Number(e.target.value))} style={{ '--progress': `${time / result.horizonMin * 100}%` } as React.CSSProperties} /><span>{timeLabel(result.horizonMin)}</span><label><span className="sr-only">Скорость воспроизведения</span><select aria-label="Скорость воспроизведения" value={speed} onChange={e => setSpeed(Number(e.target.value))}>{[1, 4, 12, 30].map(value => <option key={value} value={value}>{value} мин/с</option>)}</select></label><button aria-label="Повторять смену" title="Повторять смену" aria-pressed={loop} onClick={() => setLoop(!loop)}><Repeat2 size={17} /></button></div>
    <div className="terminal-milestones">{milestones.map((m, i) => <button key={i} onClick={() => seek(m.at)}><span />{m.label}<small>{timeLabel(m.at)}</small></button>)}</div>
  </div>;
}

function eventLabel(type: string, stage: string) {
  if (type === 'arrival') return 'Прибытие на терминал';
  if (type === 'quality-release') return 'Допуск партии по качеству';
  if (type === 'outage-start') return 'Пост недоступен';
  if (type === 'outage-end') return 'Работа поста восстановлена';
  const names: Record<string, string> = { gate: 'регистрации', loading: 'налива', dispatch: 'оформления', lab: 'анализа' };
  return `${type === 'start' ? 'Начало' : 'Завершение'} ${names[stage] ?? stage}`;
}
