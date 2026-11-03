// Shared progression fixture (S23/S24/S28): 6 heroes, items, ranks, chapter.
const combat=o=>({hp:1000,attack:100,defense:10,speed:1000,range:20000,attack_interval_ms:100,energy_start:0,energy_per_second:0,energy_per_attack:0,...o});
const hero=(id,name,faction='faction_one',o={})=>({id,kind:'hero',name,data:{faction_id:faction,ability_ids:['ability_one'],combat:combat(o)}});
export const progressionContent=()=>({schema_version:1,content_version:'progression_fixture',required_capabilities:['content.core.v1','battle.combat.v1','campaign.chapters.v1','heroes.progression.v1'],entities:[
 {id:'faction_one',kind:'faction',name:'Ф1',data:{advantage_ids:[]}},
 {id:'faction_two',kind:'faction',name:'Ф2',data:{advantage_ids:[]}},
 {id:'ability_one',kind:'ability',name:'У',data:{effect:'damage',power:1,cooldown_ms:1000}},
 hero('hero_a','Батыр'),hero('hero_b','Лучница'),hero('hero_c','Знахарь'),hero('hero_d','Страж'),hero('hero_e','Охотник'),hero('hero_f','Шаман','faction_two'),
 hero('enemy_one','Волк','faction_one',{hp:50,attack:1}),
 {id:'item_sword',kind:'item',name:'Сабля',data:{stack_limit:1,slot:'weapon',stats:{attack:100},upgrade_max:2,upgrade_bp:5000,upgrade_gold:30}},
 {id:'item_bow',kind:'item',name:'Лук',data:{stack_limit:1,slot:'weapon',stats:{attack:40}}},
 {id:'item_elf_armor',kind:'item',name:'Доспех Ф2',data:{stack_limit:1,slot:'armor',stats:{defense:50},faction_ids:['faction_two']}},
 {id:'stage_one',kind:'stage',name:'Опушка',data:{enemy_hero_ids:['enemy_one'],time_limit_ms:90000,rewards_first_heroes:['hero_f'],rewards_first_items:['item_bow'],rewards_first:[{currency:'hero_exp',amount:500}]}},
 {id:'stage_two',kind:'stage',name:'Логово',data:{enemy_hero_ids:['enemy_one'],time_limit_ms:90000,enemy_level:5}},
 {id:'chapter_one',kind:'chapter',name:'Глава',data:{order:1,stage_ids:['stage_one','stage_two']}},
 {id:'progression_main',kind:'progression',name:'Развитие',data:{level_gold_base:10,level_gold_step:5,level_exp_base:20,level_exp_step:10,growth_bp:1000,
  ranks:[{name:'Новичок',max_level:3,copies:0,stat_bp:0},{name:'Боец',max_level:5,copies:2,stat_bp:2000}],material_per_copy:50,sync_slots:2,
  starter_hero_ids:['hero_a','hero_b','hero_c','hero_d','hero_e','hero_a','hero_a','hero_b'],starter_item_ids:['item_sword','item_elf_armor']}}]});
/** Progression fixture + VIP, summon pool and AFK (S25/S27/S29). */
export const economyContent=(o={})=>{
 const c=progressionContent();
 c.content_version='economy_fixture';
 c.required_capabilities.push('vip.v1','summon.v1','afk.v1');
 c.entities.push(
  {id:'vip_main',kind:'vip',name:'VIP',data:{levels:[{points:100,perks_text:'VIP 1',afk_hours:0},{points:500,perks_text:'+2 ч AFK',afk_hours:2},{points:1000000000,perks_text:'Огромный порог'}],tutorial_points:100,daily_points:50,win_points:10,win_points_daily_cap:30,proposed:true,...o.vip}},
  {id:'pool_main',kind:'summon_pool',name:'Призыв',data:{cost:{currency:'gems',amount:10},entries:[{hero_id:'hero_a',weight:1},{hero_id:'hero_b',weight:1},{hero_id:'hero_c',weight:2,shards:5},{hero_id:'hero_f',weight:1}],guarantee:{every:3,hero_ids:['hero_f']},shards_per_hero:10,...o.pool}},
  {id:'afk_main',kind:'afk',name:'AFK',data:{per_hour:[{currency:'gold',amount:3600},{currency:'hero_exp',amount:360}],stage_bonus_bp:5000,...o.afk}});
 return c;
};
/** Economy fixture + battle speeds (S26) and quests (S30). */
export const speedQuestContent=(o={})=>{
 const c=economyContent();
 c.content_version='speed_quest_fixture';
 c.required_capabilities.push('battle.speed.v1','quests.v1');
 const vip=c.entities.find(e=>e.kind==='vip');Object.assign(vip.data,{speed_x2_stages:1,speed_x4_level:2,instant_level:3},o.vip);
 // A tougher stage for speed timing: the hero needs many steps.
 c.entities.push({id:'enemy_wall',kind:'hero',name:'Стена',data:{faction_id:'faction_one',ability_ids:['ability_one'],combat:{hp:1000000,attack:0,defense:1000000,speed:0,range:0,attack_interval_ms:1000,energy_start:0,energy_per_second:0,energy_per_attack:0}}},
  {id:'stage_long',kind:'stage',name:'Долгий бой',data:{enemy_hero_ids:['enemy_wall'],time_limit_ms:90000}});
 const q=(id,name,data)=>({id,kind:'quest',name,data:{proposed:true,...data}});
 c.entities.push(
  q('quest_daily_wins','Две победы за день',{period:'daily',event:'battle_win',target:2,rewards:[{currency:'gold',amount:100}],order:1}),
  q('quest_clear_one','Пройди Опушку',{period:'once',event:'campaign_clear',stage_id:'stage_one',target:1,rewards:[{currency:'gems',amount:50}],reward_heroes:['hero_f'],order:2}),
  q('quest_level_after','Подними уровень',{period:'once',event:'hero_level_up',target:1,rewards:[{currency:'hero_exp',amount:10}],requires_quest_id:'quest_clear_one',order:3}),
  q('quest_summon_ten','Десять призывов',{period:'once',event:'summon_pull',target:10,rewards:[{currency:'rank_material',amount:5}],order:4}),
  ...(o.quests??[]));
 return c;
};
