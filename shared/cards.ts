export const CARD_TYPES = [
  "secret",
  "deduce",
  "peek",
  "swap",
  "share",
  "rotate",
  "rumor",
  "decoy",
  "observe",
  "again",
  "chaos",
] as const;

export type CardType = (typeof CARD_TYPES)[number];
export type CharacterId = "sheep" | "hamster" | "tanuki" | "wolf" | "penguin";
export type CardCategory = "information" | "exchange" | "deduction" | "defense" | "special";

export const CARD_CATEGORY_LABELS: Record<CardCategory, string> = {
  information: "情報",
  exchange: "交換",
  deduction: "推理",
  defense: "防御",
  special: "特殊",
};

export interface CardDefinition {
  id: CardType;
  name: string;
  category: CardCategory;
  shortDescription: string;
  description: string;
  cutInText: string;
  target: "none" | "other-player" | "any-player" | "all-players";
  targetVisibility: "none" | "public" | "participants";
  character: CharacterId;
  art: string;
  accent: string;
}

export const CARD_DEFINITIONS: Record<CardType, CardDefinition> = {
  secret: {
    id: "secret",
    name: "ひみつ",
    category: "special",
    shortDescription: "みんなが探す、たった1枚のカード",
    description: "このカードの現在の持ち主が、みんなの探している『ひみつ』の持ち主です。直接は使えず、交換で人から人へ移動します。",
    cutInText: "ひみつは静かにめぐる",
    target: "none",
    targetVisibility: "none",
    character: "wolf",
    art: "/assets/characters/wolf/cards/secret.png",
    accent: "#775a91",
  },
  deduce: {
    id: "deduce",
    name: "みぬく",
    category: "deduction",
    shortDescription: "ひみつの持ち主を指名する",
    description: "全員が1回行動したあと、『ひみつ』を持っていると思う人を1人指名します。正解なら即勝利。すべて外れると、その時点の持ち主が逃げ切り勝ちです。",
    cutInText: "そのひみつ、みぬいた！",
    target: "other-player",
    targetVisibility: "public",
    character: "tanuki",
    art: "/assets/characters/tanuki/cards/deduce.png",
    accent: "#e06a55",
  },
  peek: {
    id: "peek",
    name: "ちらり",
    category: "information",
    shortDescription: "相手のカードを1枚だけ見る",
    description: "ほかの人を1人選び、手札からランダムな1枚を自分だけ見ます。見たカードの内容と対象者はほかの人に公開されません。",
    cutInText: "ほんの少しだけ、ちらり",
    target: "other-player",
    targetVisibility: "participants",
    character: "wolf",
    art: "/assets/characters/wolf/cards/peek.png?v=2",
    accent: "#506fa0",
  },
  swap: {
    id: "swap",
    name: "こっそり交換",
    category: "exchange",
    shortDescription: "相手とランダムに1枚交換",
    description: "選んだ人と、手札をランダムに1枚ずつ交換します。交換したカードの内容と対象者はほかの人に公開されません。",
    cutInText: "気づかれないように、そっと",
    target: "other-player",
    targetVisibility: "participants",
    character: "tanuki",
    art: "/assets/characters/tanuki/cards/swap.png",
    accent: "#94734b",
  },
  share: {
    id: "share",
    name: "おすそわけ",
    category: "exchange",
    shortDescription: "お互いに選んだ1枚を交換",
    description: "選んだ人と、お互いに渡すカードを1枚ずつ選んで交換します。カードの内容と対象者は当事者だけの情報です。",
    cutInText: "はい、これをどうぞ",
    target: "other-player",
    targetVisibility: "participants",
    character: "hamster",
    art: "/assets/characters/hamster/cards/share.png",
    accent: "#e69955",
  },
  rotate: {
    id: "rotate",
    name: "ぐるっと回す",
    category: "exchange",
    shortDescription: "全員の1枚を左どなりへ回す",
    description: "全員が手札から1枚を選び、そろったら席番号が次の人（左どなり）へ同時に渡します。選んだカードの内容は公開されません。",
    cutInText: "ぐるっと、ひとつ隣へ！",
    target: "all-players",
    targetVisibility: "none",
    character: "penguin",
    art: "/assets/characters/penguin/cards/rotate.png",
    accent: "#427caf",
  },
  rumor: {
    id: "rumor",
    name: "うわさ",
    category: "information",
    shortDescription: "本当を含む候補をみんなに公開",
    description: "本当の持ち主を必ず含む候補を、3〜4人なら2人、5〜8人なら3人公開します。候補は全員が確認できます。",
    cutInText: "こんなうわさ、聞いたよ",
    target: "none",
    targetVisibility: "none",
    character: "sheep",
    art: "/assets/characters/sheep/cards/rumor-clean.png",
    accent: "#55a58d",
  },
  decoy: {
    id: "decoy",
    name: "おとり",
    category: "defense",
    shortDescription: "1人を一時的にみぬくから守る",
    description: "自分を含む1人を選び、使用者の次の番が始まるまで『みぬく』の対象から守ります。守られている状態は全員に表示されます。",
    cutInText: "こっちに注目！",
    target: "any-player",
    targetVisibility: "public",
    character: "tanuki",
    art: "/assets/characters/tanuki/cards/decoy.png",
    accent: "#b07c43",
  },
  observe: {
    id: "observe",
    name: "じっくり観察",
    category: "information",
    shortDescription: "相手の全手札を見る代わりに1枚見せる",
    description: "相手の手札を全部見る代わりに、自分の手札からランダムな1枚を相手に見られます。見た内容と対象者は当事者だけの情報です。",
    cutInText: "じっくり見れば、わかるはず",
    target: "other-player",
    targetVisibility: "participants",
    character: "penguin",
    art: "/assets/characters/penguin/cards/observe.png",
    accent: "#54648d",
  },
  again: {
    id: "again",
    name: "もう一回",
    category: "special",
    shortDescription: "続けてもう1回行動する",
    description: "このカードを使ったあと、続けてもう1回だけ行動できます。『もう一回』を連続して使うことはできません。",
    cutInText: "まだ終わりじゃない！",
    target: "none",
    targetVisibility: "none",
    character: "penguin",
    art: "/assets/characters/penguin/cards/again.png",
    accent: "#496da8",
  },
  chaos: {
    id: "chaos",
    name: "大混乱",
    category: "special",
    shortDescription: "全員の手札をランダムに配り直す",
    description: "全員の手札を集め、各自の枚数を保ったままランダムに配り直します。その後、本当の持ち主を含む2〜3人の候補を全員に公開します。",
    cutInText: "どこに行くかは、だれにもわからない！",
    target: "none",
    targetVisibility: "none",
    character: "hamster",
    art: "/assets/characters/hamster/cards/chaos.png",
    accent: "#d85d83",
  },
};

export const DECK_COUNTS: Record<number, Partial<Record<CardType, number>>> = {
  3: { secret: 1, deduce: 2, peek: 2, swap: 1, share: 2, rotate: 1, rumor: 1, decoy: 1, again: 1 },
  4: { secret: 1, deduce: 2, peek: 2, swap: 2, share: 3, rotate: 2, rumor: 1, decoy: 1, again: 1, chaos: 1 },
  5: { secret: 1, deduce: 2, peek: 3, swap: 3, share: 3, rotate: 2, rumor: 2, decoy: 1, observe: 1, again: 1, chaos: 1 },
  6: { secret: 1, deduce: 2, peek: 3, swap: 4, share: 4, rotate: 3, rumor: 2, decoy: 1, observe: 1, again: 2, chaos: 1 },
  7: { secret: 1, deduce: 3, peek: 4, swap: 4, share: 5, rotate: 4, rumor: 2, decoy: 1, observe: 1, again: 2, chaos: 1 },
  8: { secret: 1, deduce: 3, peek: 5, swap: 5, share: 6, rotate: 4, rumor: 3, decoy: 1, observe: 1, again: 2, chaos: 1 },
};
