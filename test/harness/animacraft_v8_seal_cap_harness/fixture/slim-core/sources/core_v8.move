/// Test-only schema-2 driver. Only base_registry_v8 is the exact production target.
module animacraft_v8_core::core_v8;
use animacraft_v8_core::base_registry_v8::{Self as base, BaseDefinitionRegistryV8, TrackRowV2, ColorChannelRowV2, PartRowV2, ItemRowV2, StyleRowV2, AssetRowV2};
use animacraft_v8_core::maker_v8::{Self as maker, MakerRootV8, MakerAdminCapV8};
use std::bcs;
use std::option;
use std::string::{Self as string, String};
use sui::sui::SUI;

fun key(mut prefix: vector<u8>, index: u64): String {
    assert!(index < 10000, 0);
    let mut divisor = 1000;
    while (divisor > 0) { prefix.push_back(48 + (((index / divisor) % 10) as u8)); divisor = divisor / 10; };
    string::utf8(prefix)
}
fun hash(): vector<u8> { let mut h: vector<u8> = vector[]; let mut i=0u64; while (i < 32){h.push_back(5);i=i+1;};h }
fun track(): TrackRowV2 { base::new_track_row_v2(0,b"track".to_string(),b"Track".to_string(),0,false) }
fun color(i:u64): ColorChannelRowV2 {
    base::new_color_channel_row_v2(i,key(b"color",i),b"Color".to_string(),b"swatch".to_string(),
        vector[base::new_color_swatch_v2(b"swatch".to_string(),b"Swatch".to_string(),4294967295,vector[])])
}
fun part(): PartRowV2 {
    let tokens=vector[];
    let vis=base::visibility_program_commitment_v1(1,option::none(),0,b"part".to_string(),option::none(),option::none(),&tokens);
    base::new_part_row_v2(0,b"part".to_string(),b"Part".to_string(),0,0,0,true,false,1,1,vector[b"track".to_string()],tokens,vis,hash())
}
fun item(i:u64): ItemRowV2 {
    let tokens=vector[];
    let vis=base::visibility_program_commitment_v1(1,option::none(),1,b"part".to_string(),option::some(key(b"item",i)),option::none(),&tokens);
    base::new_item_row_v2(i,b"part".to_string(),key(b"item",i),b"Item".to_string(),0,0,key(b"style",i),tokens,vis,hash())
}
fun style(i:u64,colored:bool,unique:bool): StyleRowV2 {
    let owner=if(unique)i else 0;
    let tokens=vector[];
    let vis=base::visibility_program_commitment_v1(1,option::none(),2,b"part".to_string(),option::some(key(b"item",owner)),option::some(key(b"style",i)),&tokens);
    base::new_style_row_v2(i,b"part".to_string(),key(b"item",owner),key(b"style",i),b"Style".to_string(),i,b"track".to_string(),
        if(colored)option::some(key(b"color",i))else option::none(),if(colored)option::some(b"swatch".to_string())else option::none(),
        key(b"asset",owner),b"fixture-blob".to_string(),hash(),false,
        base::new_transform_fixed_v1(base::new_signed_milli_v1(false,0),base::new_signed_milli_v1(false,0),1000000,base::new_signed_milli_v1(false,0)),
        1000000,0,option::none(),tokens,vis,hash())
}
fun asset(i:u64): AssetRowV2 { base::new_asset_row_v2(i,key(b"asset",i),b"image".to_string(),b"image/png".to_string(),1,hash()) }

public fun create_registry(styles:u64,colored:bool,unique:bool,ctx:&mut TxContext) {
    let colors=if(colored)styles else 0;
    let items=if(unique)styles else 1;
    let counts=base::new_base_definition_counts_v8(1,colors,1,items,styles,0,items);
    let mut rolling=base::author_rows_empty_commitment_v2();
    let mut seq=0;
    rolling=base::author_rows_advance_commitment_v2(0,0,seq,rolling,bcs::to_bytes(&track()));seq=seq+1;
    let mut i=0;
    while (i < colors){rolling=base::author_rows_advance_commitment_v2(1,i,seq,rolling,bcs::to_bytes(&color(i)));seq=seq+1;i=i+1;};
    rolling=base::author_rows_advance_commitment_v2(2,0,seq,rolling,bcs::to_bytes(&part()));seq=seq+1;
    i=0;while (i < items){rolling=base::author_rows_advance_commitment_v2(3,i,seq,rolling,bcs::to_bytes(&item(i)));seq=seq+1;i=i+1;};
    i=0;while (i < styles){rolling=base::author_rows_advance_commitment_v2(4,i,seq,rolling,bcs::to_bytes(&style(i,colored,unique)));seq=seq+1;i=i+1;};
    i=0;while (i < items){rolling=base::author_rows_advance_commitment_v2(6,i,seq,rolling,bcs::to_bytes(&asset(i)));seq=seq+1;i=i+1;};
    let expected=base::author_rows_seal_commitment_v2(vector[1,colors,1,items,styles,0,items],rolling);
    let(mut root,admin)=maker::new_root_for_seal_cap<SUI>(seq,expected,hash(),ctx);
    let mut registry=base::new_base_definition_registry_v8(&root,&admin,counts,ctx);
    maker::finalize_base_registry_binding_v8(&mut root,&admin,object::id(&registry));
    base::append_track_v2(&mut registry,&root,&admin,track());
    base::share_base_definition_registry_v8(registry);
    maker::share_maker_root_and_admin_v8(root,admin,ctx);
}
public fun append_colors(registry:&mut BaseDefinitionRegistryV8,root:&MakerRootV8<SUI>,admin:&MakerAdminCapV8,start:u64,count:u64) {
    let mut i=start;while (i < start+count){base::append_color_v2(registry,root,admin,color(i));i=i+1;};
}
public fun append_items(registry:&mut BaseDefinitionRegistryV8,root:&MakerRootV8<SUI>,admin:&MakerAdminCapV8,start:u64,count:u64) {
    if(start==0)base::append_part_v2(registry,root,admin,part());
    let mut i=start;while (i < start+count){base::append_item_v2(registry,root,admin,item(i));i=i+1;};
}
public fun append_styles(registry:&mut BaseDefinitionRegistryV8,root:&MakerRootV8<SUI>,admin:&MakerAdminCapV8,start:u64,count:u64,colored:bool,unique:bool) {
    let mut i=start;while (i < start+count){base::append_style_v2(registry,root,admin,style(i,colored,unique));i=i+1;};
}
public fun append_assets(registry:&mut BaseDefinitionRegistryV8,root:&MakerRootV8<SUI>,admin:&MakerAdminCapV8,start:u64,count:u64) {
    let mut i=start;while (i < start+count){base::append_asset_v2(registry,root,admin,asset(i));i=i+1;};
}
public fun seal(registry:&mut BaseDefinitionRegistryV8,root:&mut MakerRootV8<SUI>,admin:&MakerAdminCapV8) { base::seal_base_definition_registry_v8(registry,root,admin); }
