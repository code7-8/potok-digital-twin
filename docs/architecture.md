# Архитектура ПОТОК

Статус: ядро, эксперименты, API, постоянное хранение и шесть экранов реализованы. Автоматические проверки и сборка проходят. Слой 3D переработан и проверяется отдельными сквозными сценариями; полная приёмка остальных экранов остаётся отдельным этапом. Подробный статус — в HANDOFF.md и [terminal-3d.md](terminal-3d.md).

## Компоненты

```mermaid
flowchart LR
  UI[Рабочее место аналитика] --> W[Web Worker расчётов]
  UI --> API[Серверные маршруты]
  UI --> TOUR[Three.js сцена]
  W --> TASKS[compute-task: расчёт, сравнение, поиск, демонстрация]
  TASKS --> CORE[Чистое расчётное ядро]
  TOUR --> PROJ[Проекция событий на выбранное время]
  PROJ --> RESULT[Результат расчёта]
  CORE --> RESULT
  API --> AUTH[Сессия и роль]
  API --> DB[(SQLite / D1)]
  API --> VALIDATE[Проверка контрактов]
  VALIDATE --> CORE
  RESULT --> UI
```

Расчёт не зависит от облака. Browser worker не блокирует интерфейс, получает сериализуемые входы и возвращает прогресс/результат. Сервер валидирует сохраняемые параметры и не доверяет клиентскому названию роли. Сохранённые результаты сопровождаются исходными параметрами и версией; для проверки сервер или CLI может пересчитать их тем же ядром.

## Варианты использования

`compute.worker.ts` отвечает за обмен сообщениями и ошибки; `compute-task.ts` — за состав вычислений. `demonstration.ts` строит четыре воспроизводимых шага на текущем наборе данных. `decision-review.ts` проверяет актуальность сравнения и получает изменения параметров/пик очереди из результатов. Компоненты `scenario-comparison.tsx` и `demonstration-route.tsx` показывают эти данные без повторной реализации формул ядра. `SearchResult.sourceScenario` хранит условия уже выполненного поиска; после их изменения UI помечает предыдущий результат.

Актуальное состояние проверок и ограничения среды: [acceptance.md](acceptance.md).

```mermaid
flowchart LR
  A[Аналитик] --> L([Войти])
  V[Наблюдатель] --> L
  A --> D([Выбрать и проверить данные])
  A --> S([Создать сценарий])
  A --> R([Запустить расчёт])
  A --> C([Сравнить альтернативы])
  A --> E([Проверить устойчивость])
  A --> SAVE([Сохранить и экспортировать])
  V --> VIEW([Просмотреть результат])
  A --> VIEW
  V --> T([Пройти 3D-тур])
  A --> T
  C --> R
  E --> R
```

## Состояния заявки

```mermaid
stateDiagram-v2
  [*] --> NotArrived
  NotArrived --> GateQueue: arrival
  GateQueue --> Registration: gate free
  Registration --> SupplyWait: insufficient released stock
  Registration --> LoadingQueue: released stock available
  SupplyWait --> LoadingQueue: stock becomes available
  LoadingQueue --> SupplyWait: stock allocated to another order
  LoadingQueue --> Loading: compatible bay + atomic allocation
  Loading --> Paused: outage begins
  Paused --> Loading: outage ends
  Loading --> DispatchQueue: load complete
  DispatchQueue --> Documents: dispatcher free
  Documents --> Completed: quantity control and documents complete
  Completed --> [*]
```

В ядре пауза представлена интервалом внутри Visit налива; в визуальной проекции она получает отдельное отображаемое состояние. Конец смены не переводит все заявки в Completed, а фиксирует их фактическое состояние.

## Действия аналитика

```mermaid
flowchart TD
  START([Начало]) --> INPUT[Выбор набора]
  INPUT --> CHECK{Валидация}
  CHECK -- Ошибка --> FIX[Показать поле и причину]
  FIX --> INPUT
  CHECK -- Успех --> BASE[Рассчитать базу]
  BASE --> CHANGE[Изменить параметры сценария]
  CHANGE --> RUN[Парное сравнение]
  RUN --> EXPLAIN[Метрики и причины ожидания]
  EXPLAIN --> ROBUST[Стресс-сценарий и проверочные seeds]
  ROBUST --> DECIDE{Результат приемлем?}
  DECIDE -- Нет --> CHANGE
  DECIDE -- Да --> SAVE[Сохранить решение и допущения]
  SAVE --> END([Демонстрация или экспорт])
```

## Последовательность сохранения и расчёта

```mermaid
sequenceDiagram
  actor Analyst as Аналитик
  participant UI as React UI
  participant API as API
  participant Auth as Проверка сессии
  participant DB as SQLite / D1
  participant Worker as Web Worker
  participant Engine as Ядро
  Analyst->>UI: Параметры альтернативы
  UI->>Worker: Набор + параметры + seed
  Worker->>Engine: Расчёт смены
  Engine-->>Worker: События и метрики
  Worker-->>UI: Результат
  Analyst->>UI: Сохранить расчёт
  UI->>API: POST /api/calculations
  API->>Auth: Проверить cookie и роль
  Auth-->>API: ID, роль
  API->>DB: Получить исходный набор
  API->>Engine: Валидация и серверный перерасчёт
  Engine-->>API: Проверенные KPI
  API->>DB: batch: сценарий + расчёт + 2 записи аудита
  DB-->>API: Всё записано или всё отменено
  API-->>UI: Подтверждение
  UI-->>Analyst: Сохранённый расчёт доступен в истории
```

## Доменная модель

```mermaid
classDiagram
  class Dataset {id; version; horizonMin; provenance}
  class Order {id; product; tonnes; arrivalMin; dueMin}
  class Tank {id; product; capacityTonnes}
  class Batch {id; product; tonnes; sampleReadyMin; labMinutes}
  class Scenario {id; resourceCounts; durations; policy; outage; costs}
  class SimulationRun {engineVersion; seed; metrics; events; snapshots}
  class Visit {start; end; resourceId; activeMinutes}
  class Allocation {batchId; tonnes}
  Dataset "1" *-- "0..*" Order
  Dataset "1" *-- "0..*" Tank
  Tank "1" o-- "0..*" Batch
  Dataset "1" --> "0..*" SimulationRun
  Scenario "1" --> "0..*" SimulationRun
  SimulationRun "1" *-- "0..*" Visit
  Order "1" --> "0..3" Visit
  Order "1" --> "0..*" Allocation
  Batch "1" --> "0..*" Allocation
```

## Реализованная схема постоянного хранения

```mermaid
erDiagram
  USER ||--o{ SESSION : opens
  USER ||--o{ SCENARIO : authors
  DATASET ||--o{ SCENARIO : used_by
  SCENARIO ||--o{ RUN : produces
  USER ||--o{ AUDIT_EVENT : initiates
  USER { text id PK text login UK text name text password_hash text salt text role }
  SESSION { text token_hash PK text user_id FK integer expires_at }
  DATASET { text id PK text name text version text provenance text payload_json text content_hash integer created_at }
  SCENARIO { text id PK text dataset_id FK text owner_id FK text name text config_json integer created_at }
  RUN { text id PK text scenario_id FK text engine_version integer seed text summary_json integer created_at }
  AUDIT_EVENT { text id PK text user_id FK text action text entity_id integer created_at }
```

Версионированные JSON-поля содержат типизированные доменные объекты. Для демонстрационного масштаба это сохраняет весь вход эксперимента атомарно и не требует множества частичных обновлений. Справочники и связи верхнего уровня нормализованы. При росте объёма детализацию событий следует вынести в отдельное хранилище; полный журнал каждого эксперимента не обязан загружаться в браузер одновременно.

## Контракты

- Данные и параметры валидируются до запуска, ограничения размера применяются до parsing больших тел запросов.
- Входы ядра не мутируются; его результат не зависит от `Date.now`, сети или глобального random.
- Для запуска фиксируются версия ядра, ID/версия и хеш данных, параметры сценария, seeds.
- Локальные предпочтения интерфейса могут храниться в browser storage. Сценарии и расчётные записи хранятся в БД.
- Экспорт не содержит пароль, токен сессии или реальные персональные данные.

## Сохранение и повтор

`POST /api/calculations` сохраняет параметры сценария, один проверенный прогон и аудит одной транзакцией D1 `batch`. Расчёт выполняется до записи. Старые отдельные `POST /scenarios` и `POST /runs` остаются доступны; каждый атомарен со своей записью аудита.

`GET /api/runs/:id` возвращает исходный набор, сценарий и запись расчёта. Сервер проверяет SHA-256 данных. Клиент проверяет версию ядра, повторяет прогон с сохранённым seed и сравнивает все KPI с допуском 1e-9 относительно масштаба числа. При несовпадении выводится ошибка; история не изменяется. Открытие только параметров сценария отдельно обозначено как предварительный расчёт с seed 42.

Миграции локальной БД ведёт Wrangler (`wrangler.local.json`, `scripts/local-db.mjs`). Уже существующая схема принимается только при точном совпадении с начальной миграцией. Скрипт не удаляет данные и не выполняет удалённых запросов к БД.

Основание поведения транзакций и миграций: [D1 Database](https://developers.cloudflare.com/d1/worker-api/d1-database/), [D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).


## Слой визуального воспроизведения

`SimulationResult → terminal/playback → terminal/renderer → Three.js` — однонаправленная проекция. Визуальный слой не меняет сущности, распределение продукта или результаты. React владеет общим временем, настройками камеры и выбором объекта; Renderer получает их после commit через ref. Динамическая загрузка Three.js, объединение статической геометрии, инстансирование автопарка, отрисовка по изменению и явное освобождение ресурсов уменьшают стоимость сцены. При потере WebGL доступные карточки, события и управление временем остаются рабочими. Подробная карта файлов и данных — в [terminal-3d.md](terminal-3d.md).
