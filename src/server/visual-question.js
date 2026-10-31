/** Conservative local routing: no extra AI classifier and no screenshot for every comment. */
export function needsScreenContext(text) {
  if(typeof text!=='string')return false;
  if(/(?:look at|check|read|show me).{0,25}(?:screen|preview|gameplay|outfit|costume)|(?:画面|配信).{0,12}(?:見て|確認して|読んで)/iu.test(text))return true;
  const question=/[?？]|\b(?:what|which|where|why|how|who)\b|何|どの|どう|どれ|どこ|誰/iu.test(text);
  const currentGame=/\b(?:what|which) game.{0,35}\b(?:this|that|they|playing|now)\b|\bwhat (?:is|are) (?:they|he|she|the streamer).{0,20}\b(?:doing|playing|wearing)\b|\bwho(?:'s| is) (?:winning|leading)\b|\bwhat(?:'s| is) the score\b|今.{0,15}(?:ゲーム|スコア|勝って|してる|やって)/iu.test(text);
  return question&&(currentGame||/(?:\b(?:round|finals?|screen|preview|map|stage|level|mechanic|obstacle|costume|outfit|happening)\b|\bwhat(?:'s| is) (?:this|that)\b|画面|ラウンド|決勝|ステージ|マップ|ギミック|障害物|衣装|何が起き)/iu.test(text));
}

export const visualFailure = error => ['stream_offline','twitch_auth_failed','twitch_credentials_missing','twitch_unavailable',
  'frame_unavailable','invalid_frame_url','invalid_frame','frame_too_large'].includes(error?.message)?error.message:'frame_unavailable';
