# Browser Candidate Search Agent

Автономный AI-агент для поиска разработчиков на любых платформах по natural language запросам. Универсальный подход без привязки к конкретному сайту.

## Быстрый старт

```bash
# 1. Установка зависимостей
npm install
npx playwright install chromium

# 2. Настройка API ключа
cp .env.example .env
# Отредактируйте .env и добавьте ваш OpenAI API ключ

# 3. Запуск
npm start
# или для разработки (БЕЗ hot-reload):
npm run dev
```

⚠️ **ВАЖНО:** Не используйте `tsx watch` - он блокирует stdin и вы не сможете вводить команды!

## Пример использования

```
> Найди 3 Go-разработчиков с опытом в микросервисах на GitHub

[Агент открывает браузер, исследует GitHub, находит кандидатов]

🤖 SUB-AGENT ACTIVATED: Profile Scanner
   Target: username1
   [Суб-агент сканирует профиль, извлекает данные]
✅ SUB-AGENT SCAN COMPLETE

════════════════════════════════════════════════════════
📊 Results
════════════════════════════════════════════════════════

1. username1
   https://github.com/username1
   Name: John Doe
   Bio: Backend Engineer focused on distributed systems...
   Location: San Francisco, CA
   Company: TechCorp
   Languages: Go, Rust, Python
   Skills: Kubernetes, Docker, gRPC, PostgreSQL
   Repos: 45
   Followers: 1200

   📝 TL;DR:
   Senior backend engineer at TechCorp, specialized in distributed
   systems and microservices architecture with Go/Rust. Maintains
   popular service mesh library with 5k+ stars. Available via email.

   📱 Social Links:
      🌐 Website: https://johndoe.dev
      📧 Email: john@example.com
      🐦 Twitter: https://twitter.com/johndoe
      💼 LinkedIn: https://linkedin.com/in/johndoe
      📬 Telegram: https://t.me/johndoe

   ✓ Match: Experienced Go developer with strong microservices background
   ──────────────────────────────────────────────────────

[... остальные кандидаты ...]
```

## Возможности

- ✅ **Автономная работа** — агент сам принимает решения, без захардкоженных шагов
- ✅ **Универсальность** — работает с любым сайтом, не только GitHub
- ✅ **Видимый браузер** — смотрите как агент работает в реальном времени
- ✅ **Persistent sessions** — залогиньтесь один раз, сессия сохранится
- ✅ **Context management** — умное сжатие DOM без отправки полного HTML в LLM
- ✅ **Error handling** — retry логика с автоматическим восстановлением
- ✅ **Security layer** — подтверждение перед деструктивными действиями
- ✅ **Semantic extraction** — универсальная экстракция данных без хардкода селекторов
- ✨ **Sub-Agent для глубокого сканирования** — специализированный суб-агент исследует профили
- ✨ **Извлечение социальных сетей** — Twitter, LinkedIn, email, website, Telegram, Discord и др.
- ✨ **TL;DR саммари** — краткое резюме (2-4 предложения) для каждого кандидата
- ✨ **Навигация по вкладкам** — суб-агент проходит по всем разделам профиля (Repositories, Projects и т.д.)

## Стек технологий

- TypeScript + Node.js 20+
- Playwright (headed режим)
- OpenAI o3-mini (main agent - reasoning model with function calling)
- OpenAI gpt-4o-mini (sub-agent - fast model for profile scanning)
- readline + chalk

## Как работает суб-агент

Когда основной агент находит кандидатов, он может активировать **ProfileScannerSubAgent** для глубокого анализа:

1. **Активация**: Основной агент вызывает `scan_profile_deep(profileUrl, username)`
2. **Навигация**: Суб-агент переходит на страницу профиля
3. **Исследование**:
   - Извлекает социальные ссылки со всех видимых областей страницы
   - Находит вкладки (Repositories, Projects, Stars и т.д.)
   - Переходит по 2-3 наиболее релевантным вкладкам
   - Скроллит страницу для поиска скрытого контента
4. **Анализ**: Собирает данные о пиннед-репозиториях, организациях, навыках
5. **Генерация TL;DR**: Создаёт краткое резюме (2-4 предложения) о человеке
6. **Возврат данных**: Передаёт основному агенту `socialLinks` и `tldrSummary`

**Визуальные индикаторы в терминале:**

```
┌─────────────────────────────────────────────────────────┐
│ 🤖 SUB-AGENT ACTIVATED: Profile Scanner                │
│ Target: username                                        │
└─────────────────────────────────────────────────────────┘
  [Sub-agent iteration 1/15]
    → extract_profile_data {}
    → click {"ref": "tab_1"}
    → scroll {"direction": "down"}
┌─────────────────────────────────────────────────────────┐
│ ✅ SUB-AGENT SCAN COMPLETE                              │
└─────────────────────────────────────────────────────────┘
  📱 Social Links Found: twitter, website, email
  📝 TL;DR: Backend engineer focused on...
```

## Команды

### В терминале агента

- `search <query>` — поиск разработчиков
- `help` — показать справку
- `exit` / `quit` — выход

### Примеры запросов

- `Find 5 Go developers with microservices experience on GitHub`
- `Search for 3 TypeScript developers with React skills`
- `Найди 10 Python ML инженеров на любой платформе`

## Решение проблем

### ⚠️ Клавиатура заблокирована в ТЕРМИНАЛЕ (не можете вводить команды)

**ПРИЧИНА:** Вы запустили `tsx watch` который блокирует stdin!

**РЕШЕНИЕ:**

```bash
# 1. Остановите процесс (Ctrl+C)
# 2. Запустите правильно:
npm start
```

Подробнее смотрите [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

## Структура проекта

```
src/
├── agent/
│   ├── coordinator.ts   # Главный цикл агента с OpenAI
│   ├── sub-agent.ts     # Суб-агент для глубокого сканирования профилей
│   ├── tools.ts         # Определения инструментов
│   └── prompts.ts       # System prompt
├── browser/
│   ├── controller.ts    # Playwright wrapper
│   └── extractor.ts     # Сжатие DOM + извлечение соц. сетей
├── utils/
│   └── spinner.ts       # Анимация в терминале
├── types.ts             # Типы (Candidate, SocialLinks, ProfileScanResult)
└── index.ts             # Entry point
```

## Документация

См. [AGENTS.md](./AGENTS.md) и добавляй к своей иишке.

## Лицензия

MIT
