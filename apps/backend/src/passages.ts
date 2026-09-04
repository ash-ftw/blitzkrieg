import type { Passage } from "@blitzkrieg/shared";

const passageBank: Passage[] = [
  {
    id: "passage-r1-01",
    title: "The Essence of Systems",
    content: "Systems engineering is an interdisciplinary field of engineering and engineering management that focuses on how to design, integrate, and manage complex systems over their life cycles. At its core, systems engineering utilizes systems thinking principles to organize this body of knowledge.",
    round: 1,
    difficulty: "MEDIUM",
    wordCount: 41,
    characterCount: 279
  },
  {
    id: "passage-r1-02",
    title: "Algorithms in Motion",
    content: "An algorithm is a finite sequence of rigorous instructions, typically used to solve a class of specific problems or to perform a computation. Algorithms are used as specifications for performing calculations and data processing, automated reasoning, and software execution.",
    round: 1,
    difficulty: "MEDIUM",
    wordCount: 40,
    characterCount: 275
  },
  {
    id: "passage-r2-01",
    title: "Low Latency Networking & High Concurrency",
    content: "In modern distributed network architectures, maintaining microsecond-level latency requires zero-copy buffer allocations, event-driven non-blocking socket handling, and optimized lock-free concurrency primitives. As node density scales across high-speed campus backbones, deterministic packet processing and memory locality dictate peak system throughput and operational stability under heavy burst workloads.",
    round: 2,
    difficulty: "HARD",
    wordCount: 50,
    characterCount: 410
  }
];

export function getRandomPassage(round: 1 | 2): Passage {
  const eligible = passageBank.filter((passage) => passage.round === round);
  const randomIndex = Math.floor(Math.random() * eligible.length);
  return eligible[randomIndex] ?? passageBank[0]!;
}

export function getPassageById(id: string): Passage | null {
  return passageBank.find((p) => p.id === id) ?? null;
}
