#pragma once
#include <array>
#include <cstdint>
#include <vector>
#include <memory>

namespace poker {
using Card = uint8_t; // rank * 4 + suit; ranks 2..A, suits c,d,h,s
using Mask = uint64_t;
enum class Game { Holdem, Omaha, Omaha8 };
struct Combo { Mask mask; double weight; };
using Range = std::vector<Combo>;
struct CompiledRange;
using CompiledRangePtr = std::shared_ptr<const CompiledRange>;
CompiledRangePtr compile_range(const Range& range, Game game, Mask blocked = 0);
struct Options {
    Game game = Game::Holdem;
    bool exact = false;
    uint64_t samples = 100000;
    uint64_t seed = 0;
    uint64_t max_exact = 2000000;
    uint64_t max_attempts = 0;
    unsigned threads = 1;
};
struct PlayerResult {
    double equity = 0, stderr = 0, win = 0, tie = 0, loss = 0;
    double high_win = 0, high_tie = 0, low_win = 0, low_tie = 0;
};
struct Result {
    std::vector<PlayerResult> players;
    uint64_t outcomes = 0, attempts = 0;
    double total_weight = 0;
};
unsigned card_count(Mask mask);
std::vector<Card> cards_from_mask(Mask mask);
uint32_t evaluate_high(const Card* cards, unsigned n);
// 0 means no qualifying low; otherwise smaller is better.
uint32_t evaluate_low(const Card* cards);
struct Value { uint32_t high, low; };
Value evaluate(Game game, const std::vector<Card>& hole, const std::vector<Card>& board);
long double outcome_bound(const std::vector<Range>& ranges, unsigned board_size,
                          unsigned dead_size, unsigned hole_size);
Result simulate(std::vector<Range> ranges, const std::vector<Card>& board,
                const std::vector<Card>& dead, const Options& options);
Result simulate(std::vector<CompiledRangePtr> ranges, const std::vector<Card>& board,
                const std::vector<Card>& dead, const Options& options);
} // namespace poker
