import 'react-native-url-polyfill/auto';
import React, {useEffect,useState} from 'react';
import {AppState,Linking,View,Text,ActivityIndicator} from 'react-native';
import {requireNativeViewManager} from 'expo-modules-core';
import {hydrateStorage,flushStorage} from './src/storage';
import {engine, type Snapshot} from './src/engine';
const NativePlanner=requireNativeViewManager<{snapshot:string;onAction:(e:{nativeEvent:{action:string}})=>void;style:object}>('HaskappNative');
export default function App(){
 const [state,setState]=useState<Snapshot>();const [failure,setFailure]=useState('');
 useEffect(()=>{let active=true;engine.subscribe(s=>{if(active)setState({...s})});
 const ready=hydrateStorage().then(()=>engine.initialize());
 void ready.catch(()=>{if(active)setFailure('端末データを読み込めません。既存データは保持されています。')});
 const acceptLink=async(url:string)=>{try{await ready;if(active)await engine.dispatch({type:'authCallback',payload:{url}})}catch{if(active)engine.notify('ログインリンクを処理できませんでした。もう一度お試しください。')}};
 const links=Linking.addEventListener('url',event=>{void acceptLink(event.url)});
 void Linking.getInitialURL().then(url=>{if(url)void acceptLink(url)}).catch(()=>{if(active)engine.notify('ログインリンクを読み込めませんでした。メールからもう一度開いてください。')});
 const listener=AppState.addEventListener('change',s=>engine.foreground(s==='active'));
 return ()=>{active=false;listener.remove();links.remove()};},[]);
 if(!state)return <View style={{flex:1,justifyContent:'center',alignItems:'center'}}>{failure ? <Text>{failure}</Text>:<ActivityIndicator/>}</View>;
 return <NativePlanner style={{flex:1}} snapshot={JSON.stringify(state)} onAction={e=>{try{void engine.dispatch(JSON.parse(e.nativeEvent.action)).then(flushStorage).catch(()=>engine.notify('端末への保存に失敗しました。空き容量を確認してください。'))}catch{engine.notify('操作データを読み込めません。画面を開き直してください。')}}}/>;
}
