const ADJECTIVES = [
  "행복한", "용감한", "귀여운", "조용한", "빠른", "느린", "밝은", "신비한",
  "따뜻한", "시원한", "달콤한", "씩씩한", "졸린", "활발한", "차분한", "반짝이는",
  "용맹한", "수줍은", "장난꾸러기", "느긋한", "상냥한", "엉뚱한", "멋진", "포근한",
];

const FRUITS = [
  "사과", "바나나", "포도", "딸기", "수박", "복숭아", "망고", "키위",
  "체리", "레몬", "오렌지", "자두", "블루베리", "파인애플", "감", "배",
];

const ANIMALS = [
  "고양이", "강아지", "토끼", "곰", "사자", "펭귄", "여우", "다람쥐",
  "판다", "코끼리", "기린", "수달", "부엉이", "돌고래", "햄스터", "고슴도치",
];

const NICKNAME_KEY = "community_nickname";

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateNickname(): string {
  const adj = pick(ADJECTIVES);
  const noun = Math.random() < 0.5 ? pick(FRUITS) : pick(ANIMALS);
  return adj + noun;
}

export function getStoredNickname(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(NICKNAME_KEY);
}

export function getOrCreateNickname(): string {
  const saved = getStoredNickname();
  if (saved) return saved;

  const nickname = generateNickname();
  localStorage.setItem(NICKNAME_KEY, nickname);
  return nickname;
}

export function refreshNickname(): string {
  const nickname = generateNickname();
  localStorage.setItem(NICKNAME_KEY, nickname);
  return nickname;
}
