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
