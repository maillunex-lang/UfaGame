/**
 * Starter world for testing new stages without building content by hand.
 * Original characters and names (anime-fantasy Bashkortostan); all numbers are
 * proposals. Places of chapters reuse the verified S21 geography; story points
 * are approximate and marked as manual. Enemy levels per stage were chosen by
 * simulation (tools/content/build-starter.mjs prints the balance table): the
 * stage composition matters more than the level, so levels are not monotonic.
 */
import {readFileSync} from 'node:fs';

const geo = JSON.parse(readFileSync(new URL('../../content/geo/bashkortostan.locations.json', import.meta.url), 'utf8')).entities;
const place = id => structuredClone(geo.find(e => e.id === id));

const faction = (id, name, advantage_ids) => ({id, kind: 'faction', name, data: {advantage_ids}});
const ability = (id, name, data) => ({id, kind: 'ability', name, data});
const combat = (o = {}) => ({hp: 1200, attack: 60, defense: 15, speed: 600, range: 1500, attack_interval_ms: 800, energy_start: 200, energy_per_second: 100, energy_per_attack: 100, ...o});
const hero = (id, name, faction_id, ability_ids, o) => ({id, kind: 'hero', name, data: {faction_id, ability_ids, combat: combat(o)}});
const point = (id, name, parent_id, lat_e6, lon_e6, note) => ({id, kind: 'location', name, data: {level: 'point', parent_id, lat_e6, lon_e6, description: note, source: {kind: 'manual', note: 'Приблизительное место для сюжета стартового мира'}}});
const stage = (id, name, enemies, extra = {}) => ({id, kind: 'stage', name, data: {enemy_hero_ids: enemies, time_limit_ms: 90000, ...extra}});
const item = (id, name, slot, stats, rarity = 'common', extra = {}) => ({id, kind: 'item', name, data: {stack_limit: 1, slot, rarity, stats, upgrade_max: 10, upgrade_bp: 1500, upgrade_gold: 80, ...extra}});

export function starterWorld() {
  const entities = [
    // Four main factions in a circle of advantage, two special ones against each other.
    faction('faction_steppe', 'Степь', ['faction_forest']),
    faction('faction_forest', 'Лес', ['faction_mountains']),
    faction('faction_mountains', 'Горы', ['faction_waters']),
    faction('faction_waters', 'Воды', ['faction_steppe']),
    faction('faction_light', 'Свет', ['faction_shadow']),
    faction('faction_shadow', 'Тень', ['faction_light']),

    // Player heroes' abilities (first in the hero list = manual main ability).
    ability('ability_saber_rush', 'Сабельный натиск', {effect: 'damage', power: 260, cooldown_ms: 3000, energy_cost: 600}),
    ability('ability_hawk_arrow', 'Стрела беркута', {effect: 'damage', power: 300, cooldown_ms: 3000, energy_cost: 600, target: 'weakest_enemy'}),
    ability('ability_stone_wall', 'Каменный заслон', {effect: 'knockback', power: 2500, cooldown_ms: 4000, energy_cost: 500, extra_effects: [{effect: 'damage', power: 120}]}),
    ability('ability_spring_water', 'Живая вода', {effect: 'heal', power: 350, cooldown_ms: 3000, energy_cost: 500, target: 'ally_lowest'}),
    ability('ability_hammer_blow', 'Удар кузнеца', {effect: 'stun', power: 1500, cooldown_ms: 5000, energy_cost: 600, extra_effects: [{effect: 'damage', power: 150}]}),
    ability('ability_dawn_light', 'Рассветный луч', {effect: 'damage', power: 180, cooldown_ms: 4000, energy_cost: 700, target: 'all_enemies'}),
    ability('ability_wind_ride', 'Скачка ветра', {effect: 'damage', power: 220, cooldown_ms: 2500, energy_cost: 500, extra_effects: [{effect: 'knockback', power: 1200}]}),
    ability('ability_lake_shield', 'Озёрный щит', {effect: 'heal', power: 300, cooldown_ms: 3000, energy_cost: 500, target: 'self'}),
    ability('ability_night_blade', 'Ночной клинок', {effect: 'damage', power: 380, cooldown_ms: 3500, energy_cost: 700, target: 'weakest_enemy'}),
    ability('ability_kurai_song', 'Песнь курая', {effect: 'stun', power: 1000, cooldown_ms: 5000, energy_cost: 700, target: 'all_enemies'}),
    // Automatic abilities with trigger blocks.
    ability('ability_healing_rain', 'Целебный дождь', {effect: 'heal', power: 160, cooldown_ms: 4000, target: 'ally_lowest', trigger: {kind: 'ally_hp_below', percent: 50}}),
    ability('ability_last_stand', 'Последний рубеж', {effect: 'heal', power: 250, cooldown_ms: 8000, target: 'self', trigger: {kind: 'self_hp_below', percent: 30}}),
    ability('ability_war_cry', 'Боевой клич', {effect: 'stun', power: 800, cooldown_ms: 1000, target: 'all_enemies', trigger: {kind: 'battle_start'}}),
    ability('ability_quick_shot', 'Быстрый выстрел', {effect: 'damage', power: 70, cooldown_ms: 2000}),

    // Enemy abilities.
    ability('ability_bite', 'Укус', {effect: 'damage', power: 120, cooldown_ms: 3000, energy_cost: 600}),
    ability('ability_swamp_mist', 'Болотный туман', {effect: 'stun', power: 700, cooldown_ms: 6000, energy_cost: 800}),
    ability('ability_rock_throw', 'Бросок валуна', {effect: 'damage', power: 200, cooldown_ms: 4000, energy_cost: 700, extra_effects: [{effect: 'knockback', power: 800}]}),
    ability('ability_river_wave', 'Речная волна', {effect: 'damage', power: 160, cooldown_ms: 5000, energy_cost: 700, target: 'all_enemies'}),
    ability('ability_serpent_coil', 'Кольца змея', {effect: 'stun', power: 1500, cooldown_ms: 6000, energy_cost: 700, extra_effects: [{effect: 'damage', power: 250}]}),
    ability('ability_cave_regrowth', 'Каменная кожа', {effect: 'heal', power: 300, cooldown_ms: 9000, target: 'self', trigger: {kind: 'self_hp_below', percent: 40}}),
    ability('ability_mountain_wrath', 'Гнев горы', {effect: 'damage', power: 240, cooldown_ms: 5000, energy_cost: 800, target: 'all_enemies', extra_effects: [{effect: 'stun', power: 800, target: 'all_enemies'}]}),

    // Ten player heroes.
    hero('hero_azamat', 'Азамат, батыр степи', 'faction_steppe', ['ability_saber_rush', 'ability_last_stand'], {hp: 1600, attack: 75, defense: 25, speed: 700, range: 1200}),
    hero('hero_aigul', 'Айгуль, лучница', 'faction_forest', ['ability_hawk_arrow', 'ability_quick_shot'], {hp: 1000, attack: 70, defense: 10, speed: 500, range: 6000, attack_interval_ms: 900}),
    hero('hero_karagai', 'Карагай, страж гор', 'faction_mountains', ['ability_stone_wall'], {hp: 2400, attack: 45, defense: 40, speed: 500, range: 1200, attack_interval_ms: 1000}),
    hero('hero_zulfia', 'Зульфия, целительница', 'faction_waters', ['ability_spring_water', 'ability_healing_rain'], {hp: 1000, attack: 35, defense: 10, speed: 500, range: 5000, attack_interval_ms: 1000}),
    hero('hero_timer', 'Тимер, кузнец', 'faction_mountains', ['ability_hammer_blow'], {hp: 1700, attack: 65, defense: 30, speed: 600, range: 1200}),
    hero('hero_laysan', 'Ляйсан, дочь рассвета', 'faction_light', ['ability_dawn_light', 'ability_quick_shot'], {hp: 950, attack: 60, defense: 10, speed: 500, range: 5500, attack_interval_ms: 900}),
    hero('hero_buranbay', 'Буранбай, всадник', 'faction_steppe', ['ability_wind_ride'], {hp: 1400, attack: 80, defense: 20, speed: 1000, range: 1200, attack_interval_ms: 700}),
    hero('hero_nuria', 'Нурия, хранительница озёр', 'faction_waters', ['ability_lake_shield', 'ability_last_stand'], {hp: 2000, attack: 50, defense: 35, speed: 500, range: 1200, attack_interval_ms: 900}),
    hero('hero_ilgiz', 'Ильгиз, ночной следопыт', 'faction_shadow', ['ability_night_blade'], {hp: 1100, attack: 85, defense: 15, speed: 900, range: 1200, attack_interval_ms: 700}),
    hero('hero_server', 'Сэрвэр, шаман курая', 'faction_forest', ['ability_kurai_song', 'ability_war_cry'], {hp: 1100, attack: 45, defense: 15, speed: 500, range: 4500, attack_interval_ms: 1000}),

    // Enemies and bosses.
    hero('enemy_steppe_wolf', 'Степной волк', 'faction_steppe', ['ability_bite'], {hp: 2800, attack: 112, defense: 5, speed: 900, range: 1000, attack_interval_ms: 700}),
    hero('enemy_swamp_spirit', 'Болотный дух', 'faction_waters', ['ability_swamp_mist'], {hp: 2600, attack: 100, defense: 5, speed: 500, range: 4000, attack_interval_ms: 1000}),
    hero('enemy_bandit', 'Разбойник с тракта', 'faction_shadow', ['ability_bite'], {hp: 3600, attack: 138, defense: 15, speed: 700, range: 1200}),
    hero('boss_river_master', 'Хозяин Белой реки', 'faction_waters', ['ability_river_wave', 'ability_cave_regrowth'], {hp: 4200, attack: 70, defense: 25, speed: 500, range: 3000, attack_interval_ms: 1000}),
    hero('enemy_cave_bat', 'Пещерная мышь-тень', 'faction_shadow', ['ability_bite'], {hp: 2400, attack: 150, defense: 5, speed: 1200, range: 1000, attack_interval_ms: 600}),
    hero('enemy_stone_golem', 'Каменный страж', 'faction_mountains', ['ability_rock_throw'], {hp: 7200, attack: 138, defense: 35, speed: 400, range: 1200, attack_interval_ms: 1100}),
    hero('boss_cave_serpent', 'Змей Шульган-Таша', 'faction_shadow', ['ability_serpent_coil', 'ability_cave_regrowth'], {hp: 5500, attack: 85, defense: 30, speed: 600, range: 2500, attack_interval_ms: 900}),
    hero('enemy_mountain_troll', 'Горный тролль', 'faction_mountains', ['ability_rock_throw'], {hp: 8800, attack: 175, defense: 40, speed: 400, range: 1200, attack_interval_ms: 1200}),
    hero('enemy_storm_eagle', 'Грозовой орёл', 'faction_light', ['ability_bite'], {hp: 3600, attack: 188, defense: 10, speed: 1200, range: 3000, attack_interval_ms: 800}),
    hero('boss_yamantau_lord', 'Владыка Ямантау', 'faction_mountains', ['ability_mountain_wrath', 'ability_cave_regrowth'], {hp: 7000, attack: 100, defense: 45, speed: 500, range: 2500, attack_interval_ms: 1000}),

    // Equipment: one of each slot plus a rare weapon.
    item('item_steppe_saber', 'Степная сабля', 'weapon', {attack: 25}),
    item('item_felt_armor', 'Войлочный доспех', 'armor', {hp: 250, defense: 10}),
    item('item_fox_hat', 'Лисья шапка', 'helmet', {hp: 150, defense: 5}),
    item('item_ichigi_boots', 'Ичиги следопыта', 'boots', {speed: 100, defense: 5}),
    item('item_amber_beads', 'Янтарные бусы', 'jewelry', {hp: 200, attack: 10}, 'rare'),
    item('item_kurai_relic', 'Древний курай', 'artifact', {attack: 20, hp: 150}, 'epic'),
    item('item_ural_bow', 'Лук уральских мастеров', 'weapon', {attack: 45}, 'rare', {faction_ids: ['faction_forest', 'faction_light']}),

    // Geography: republic and three chapter areas from the verified dataset + story points.
    place('republic_bashkortostan'), place('city_ufa'), place('district_burzyanskiy'), place('district_beloretskiy'),
    point('point_ufa_belaya_bank', 'Берег Белой', 'city_ufa', 54716000, 55935000, 'Набережная реки Белой'),
    point('point_ufa_old_park', 'Старый парк', 'city_ufa', 54740000, 55960000, 'Парк на холмах города'),
    point('point_ufa_river_gate', 'Речные ворота', 'city_ufa', 54700000, 55990000, 'Место у слияния рек'),
    point('point_burzyan_forest', 'Бурзянская чаща', 'district_burzyanskiy', 53120000, 57300000, 'Лес у заповедника'),
    point('point_burzyan_river', 'Брод через Агидель', 'district_burzyanskiy', 53080000, 57430000, 'Река у Старосубхангулово'),
    point('point_shulgan_tash', 'Пещера Шульган-Таш', 'district_burzyanskiy', 53044000, 57065000, 'Капова пещера'),
    point('point_beloretsk_forge', 'Кузни Белорецка', 'district_beloretskiy', 53967000, 58400000, 'Старый завод'),
    point('point_iremel', 'Склон Иремеля', 'district_beloretskiy', 54519000, 58843000, 'Гора Иремель'),
    point('point_yamantau', 'Вершина Ямантау', 'district_beloretskiy', 54255000, 58103000, 'Гора Ямантау'),

    // Chapter 1 — Ufa.
    stage('stage_c1_1', 'Волки у Белой', ['enemy_steppe_wolf', 'enemy_steppe_wolf'], {location_id: 'point_ufa_belaya_bank', rewards_first: [{currency: 'gold', amount: 500}, {currency: 'hero_exp', amount: 1000}, {currency: 'gems', amount: 500}]}),
    stage('stage_c1_2', 'Туман в старом парке', ['enemy_swamp_spirit', 'enemy_steppe_wolf', 'enemy_swamp_spirit'], {enemy_level: 12, location_id: 'point_ufa_old_park', rewards_first: [{currency: 'gold', amount: 600}, {currency: 'hero_exp', amount: 1200}], rewards_first_items: ['item_fox_hat']}),
    stage('stage_c1_3', 'Разбойники у ворот', ['enemy_bandit', 'enemy_bandit', 'enemy_steppe_wolf'], {enemy_level: 4, location_id: 'point_ufa_river_gate', rewards_first: [{currency: 'gold', amount: 800}, {currency: 'hero_exp', amount: 1200}, {currency: 'rank_material', amount: 100}], rewards_first_heroes: ['hero_laysan']}),
    stage('stage_c1_boss', 'Хозяин Белой реки', ['boss_river_master', 'enemy_swamp_spirit', 'enemy_swamp_spirit'], {enemy_level: 15, location_id: 'point_ufa_belaya_bank', boss: true, rewards_first: [{currency: 'gold', amount: 1500}, {currency: 'gems', amount: 50}, {currency: 'hero_exp', amount: 2500}], rewards_first_heroes: ['hero_buranbay'], rewards_first_items: ['item_amber_beads']}),
    // Chapter 2 — Burzyan.
    stage('stage_c2_1', 'Тени в чаще', ['enemy_cave_bat', 'enemy_cave_bat', 'enemy_bandit'], {enemy_level: 7, location_id: 'point_burzyan_forest', rewards_first: [{currency: 'gold', amount: 1500}, {currency: 'hero_exp', amount: 3000}]}),
    stage('stage_c2_2', 'Брод через Агидель', ['enemy_swamp_spirit', 'enemy_stone_golem', 'enemy_swamp_spirit'], {enemy_level: 13, location_id: 'point_burzyan_river', rewards_first: [{currency: 'gold', amount: 1500}, {currency: 'hero_exp', amount: 3000}, {currency: 'rank_material', amount: 150}], rewards_first_heroes: ['hero_nuria']}),
    stage('stage_c2_3', 'Стражи пещеры', ['enemy_stone_golem', 'enemy_stone_golem', 'enemy_cave_bat', 'enemy_cave_bat'], {enemy_level: 3, location_id: 'point_shulgan_tash', rewards_first: [{currency: 'gold', amount: 2000}, {currency: 'hero_exp', amount: 3500}], rewards_first_items: ['item_ichigi_boots']}),
    stage('stage_c2_boss', 'Змей Шульган-Таша', ['boss_cave_serpent', 'enemy_cave_bat', 'enemy_stone_golem'], {enemy_level: 12, location_id: 'point_shulgan_tash', boss: true, rewards_first: [{currency: 'gold', amount: 3000}, {currency: 'gems', amount: 80}, {currency: 'hero_exp', amount: 5000}], rewards_first_heroes: ['hero_ilgiz'], rewards_first_items: ['item_ural_bow']}),
    // Chapter 3 — Beloretsk mountains.
    stage('stage_c3_1', 'Кузни Белорецка', ['enemy_bandit', 'enemy_bandit', 'enemy_stone_golem'], {enemy_level: 15, location_id: 'point_beloretsk_forge', rewards_first: [{currency: 'gold', amount: 3000}, {currency: 'hero_exp', amount: 5000}], rewards_first_items: ['item_felt_armor']}),
    stage('stage_c3_2', 'Тролли Иремеля', ['enemy_mountain_troll', 'enemy_storm_eagle', 'enemy_mountain_troll'], {enemy_level: 11, location_id: 'point_iremel', rewards_first: [{currency: 'gold', amount: 3000}, {currency: 'hero_exp', amount: 5000}, {currency: 'rank_material', amount: 200}], rewards_first_heroes: ['hero_server']}),
    stage('stage_c3_3', 'Грозовой перевал', ['enemy_storm_eagle', 'enemy_storm_eagle', 'enemy_mountain_troll', 'enemy_stone_golem'], {enemy_level: 8, location_id: 'point_iremel', rewards_first: [{currency: 'gold', amount: 3500}, {currency: 'hero_exp', amount: 6000}], rewards_first_items: ['item_kurai_relic']}),
    stage('stage_c3_boss', 'Владыка Ямантау', ['boss_yamantau_lord', 'enemy_mountain_troll', 'enemy_storm_eagle', 'enemy_storm_eagle'], {enemy_level: 9, location_id: 'point_yamantau', boss: true, rewards_first: [{currency: 'gold', amount: 5000}, {currency: 'gems', amount: 150}, {currency: 'rank_material', amount: 400}]}),
    // Training outside chapters.
    stage('stage_training', 'Тренировочный круг', ['enemy_steppe_wolf'], {location_id: 'point_ufa_old_park'}),

    {id: 'chapter_1_ufa', kind: 'chapter', name: 'Пробуждение Уфы', data: {order: 1, stage_ids: ['stage_c1_1', 'stage_c1_2', 'stage_c1_3', 'stage_c1_boss'], location_id: 'city_ufa', proposed: true, description: 'Река Белая беспокойна: из тумана выходят звери и духи.'}},
    {id: 'chapter_2_burzyan', kind: 'chapter', name: 'Тайна Шульган-Таша', data: {order: 2, stage_ids: ['stage_c2_1', 'stage_c2_2', 'stage_c2_3', 'stage_c2_boss'], location_id: 'district_burzyanskiy', proposed: true, description: 'В бурзянских лесах тени ведут к древней пещере.'}},
    {id: 'chapter_3_mountains', kind: 'chapter', name: 'Вершины Урала', data: {order: 3, stage_ids: ['stage_c3_1', 'stage_c3_2', 'stage_c3_3', 'stage_c3_boss'], location_id: 'district_beloretskiy', proposed: true, description: 'Горы просыпаются, и Владыка Ямантау зовёт на бой.'}},

    // Economy (S25/S27/S29), proposed numbers.
    {id: 'vip_main', kind: 'vip', name: 'VIP', data: {levels: [[100, 'Значок VIP', 0], [300, '+1 ч AFK', 1], [700, '+1 ч AFK', 1], [1500, '+2 ч AFK', 2], [3000, '+2 ч AFK', 2], [6000, '+3 ч AFK', 3], [10000, '+3 ч AFK, быстрый расчёт (S26)', 3], [16000, '+4 ч AFK', 4], [25000, '+4 ч AFK', 4], [40000, '+5 ч AFK', 5]].map(([points, perks_text, afk_hours]) => ({points, perks_text, afk_hours})), tutorial_points: 100, daily_points: 20, win_points: 2, win_points_daily_cap: 20, proposed: true}},
    {id: 'pool_heroes', kind: 'summon_pool', name: 'Зов героев', data: {cost: {currency: 'gems', amount: 50}, description: 'Герои Башкортостана отвечают на зов курая.',
      entries: [['hero_azamat', 10], ['hero_aigul', 10], ['hero_karagai', 10], ['hero_zulfia', 10], ['hero_timer', 10], ['hero_laysan', 4], ['hero_buranbay', 4], ['hero_nuria', 4], ['hero_ilgiz', 2], ['hero_server', 2]].map(([hero_id, weight]) => ({hero_id, weight}))
        .concat([{hero_id: 'hero_ilgiz', weight: 12, shards: 5}, {hero_id: 'hero_server', weight: 12, shards: 5}]),
      guarantee: {every: 10, hero_ids: ['hero_ilgiz', 'hero_server']}, shards_per_hero: 30, proposed: true}},
    {id: 'afk_main', kind: 'afk', name: 'AFK-награды', data: {per_hour: [{currency: 'gold', amount: 300}, {currency: 'hero_exp', amount: 400}, {currency: 'rank_material', amount: 5}], stage_bonus_bp: 800, proposed: true}},

    {id: 'progression_main', kind: 'progression', name: 'Развитие героев', data: {
      level_gold_base: 30, level_gold_step: 15, level_exp_base: 40, level_exp_step: 20, growth_bp: 800,
      ranks: [{name: 'Новичок', max_level: 20, copies: 0, stat_bp: 0}, {name: 'Воин', max_level: 40, copies: 1, stat_bp: 1500}, {name: 'Батыр', max_level: 60, copies: 2, stat_bp: 3500}, {name: 'Легенда', max_level: 100, copies: 3, stat_bp: 6000}],
      material_per_copy: 100, sync_slots: 5,
      starter_hero_ids: ['hero_azamat', 'hero_aigul', 'hero_karagai', 'hero_zulfia', 'hero_timer', 'hero_azamat', 'hero_aigul'],
      starter_item_ids: ['item_steppe_saber'], proposed: true}},
  ];
  return {
    schema_version: 1,
    // Same as a new Studio draft, so importing into a fresh draft has no base conflict.
    content_version: 'draft_001',
    required_capabilities: ['content.core.v1', 'battle.combat.v1', 'battle.abilities.v2', 'battle.triggers.v1', 'world.locations.v1', 'campaign.chapters.v1', 'heroes.progression.v1', 'vip.v1', 'summon.v1', 'afk.v1'],
    entities,
  };
}
