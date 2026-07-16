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

export interface CardDefinition {
  id: CardType;
  name: string;
  description: string;
  target: "none" | "other-player" | "any-player" | "all-players";
  character: CharacterId;
  art: string;
  accent: string;
}

export const CARD_DEFINITIONS: Record<CardType, CardDefinition> = {
  secret: {
    id: "secret",
    name: "ひみつ",
    description: "このカードの現在の持ち主が、みんなの探している『ひみつ』の持ち主です。",
    target: "none",
    character: "wolf",
    art: "/assets/characters/wolf/cards/secret.png",
    accent: "#775a91",
  },
  deduce: {
    id: "deduce",
    name: "みぬく",
    description: "ひみつを持っていると思う人を指名。正解ならその場で勝利！",
    target: "other-player",
    character: "tanuki",
    art: "/assets/characters/tanuki/cards/deduce.png",
    accent: "#e06a55",
  },
  peek: {
    id: "peek",
    name: "ちらり",
    description: "ほかの人の手札から、ランダムな1枚を自分だけ見ます。",
    target: "other-player",
    character: "wolf",
    art: "/assets/characters/wolf/cards/peek.png",
    accent: "#506fa0",
  },
  swap: {
    id: "swap",
    name: "こっそり交換",
    description: "選んだ人と、手札をランダムに1枚ずつ交換します。",
    target: "other-player",
    character: "tanuki",
    art: "/assets/characters/tanuki/cards/swap.png",
    accent: "#94734b",
  },
  share: {
    id: "share",
    name: "おすそわけ",
    description: "選んだ人と、お互いに選んだカードを1枚ずつ交換します。",
    target: "other-player",
    character: "hamster",
    art: "/assets/characters/hamster/cards/share.png",
    accent: "#e69955",
  },
  rotate: {
    id: "rotate",
    name: "ぐるっと回す",
    description: "全員が1枚選び、そろったら左どなりへ同時に渡します。",
    target: "all-players",
    character: "penguin",
    art: "/assets/characters/penguin/cards/rotate.png",
    accent: "#427caf",
  },
  rumor: {
    id: "rumor",
    name: "うわさ",
    description: "本当の持ち主を必ず含む、あやしい人の候補を公開します。",
    target: "none",
    character: "sheep",
    art: "/assets/characters/sheep/cards/rumor-clean.png",
    accent: "#55a58d",
  },
  decoy: {
    id: "decoy",
    name: "おとり",
    description: "選んだ人を、次の自分の番まで『みぬく』の対象から守ります。",
    target: "any-player",
    character: "tanuki",
    art: "/assets/characters/tanuki/cards/decoy.png",
    accent: "#b07c43",
  },
  observe: {
    id: "observe",
    name: "じっくり観察",
    description: "相手の手札を全部見る代わりに、自分の1枚を相手に見られます。",
    target: "other-player",
    character: "penguin",
    art: "/assets/characters/penguin/cards/observe.png",
    accent: "#54648d",
  },
  again: {
    id: "again",
    name: "もう一回",
    description: "カードを使ったあと、続けてもう1回行動できます。連続使用はできません。",
    target: "none",
    character: "penguin",
    art: "/assets/characters/penguin/cards/again.png",
    accent: "#496da8",
  },
  chaos: {
    id: "chaos",
    name: "大混乱",
    description: "全員の手札を集め、今の枚数を保ったままランダムに配り直します。",
    target: "none",
    character: "hamster",
    art: "/assets/characters/hamster/cards/chaos.png",
    accent: "#d85d83",
  },
};

export const DECK_COUNTS: Record<number, Partial<Record<CardType, number>>> = {
  3: { secret: 1, deduce: 1, peek: 2, swap: 2, share: 2, rotate: 1, rumor: 1, decoy: 1, again: 1 },
  4: { secret: 1, deduce: 1, peek: 2, swap: 3, share: 3, rotate: 2, rumor: 1, decoy: 1, again: 1, chaos: 1 },
  5: { secret: 1, deduce: 2, peek: 3, swap: 3, share: 3, rotate: 2, rumor: 2, decoy: 1, observe: 1, again: 1, chaos: 1 },
  6: { secret: 1, deduce: 2, peek: 3, swap: 4, share: 4, rotate: 3, rumor: 2, decoy: 1, observe: 1, again: 2, chaos: 1 },
  7: { secret: 1, deduce: 2, peek: 4, swap: 5, share: 5, rotate: 4, rumor: 2, decoy: 1, observe: 1, again: 2, chaos: 1 },
  8: { secret: 1, deduce: 2, peek: 5, swap: 6, share: 6, rotate: 4, rumor: 3, decoy: 1, observe: 1, again: 2, chaos: 1 },
};
