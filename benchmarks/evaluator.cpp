#include "fast_eval.hpp"
#include <algorithm>
#include <chrono>
#include <iostream>
#include <numeric>
#include <random>

using Clock = std::chrono::steady_clock;
struct Sample {
    std::array<poker::Card, 9> cards;
    poker::FastHole hole;
    poker::FastBoard board;
};
template<class F> void bench(const char* name, const std::vector<Sample>& hands, unsigned repeats, F evaluate) {
    uint64_t checksum = 0;
    auto start = Clock::now();
    for (unsigned n = 0; n < repeats; ++n) for (const auto& h : hands) checksum += evaluate(h);
    double seconds = std::chrono::duration<double>(Clock::now() - start).count();
    std::cout << name << ": " << hands.size() * repeats / seconds / 1e6 << " million hands/s; checksum=" << checksum << "\n";
}
int main(int argc, char** argv) {
    poker::initialize_omaha_table();
    size_t count = argc > 1 ? std::stoull(argv[1]) : 100000;
    if (!count || count > 1000000) return 2;
    unsigned repeats = unsigned(std::max<size_t>(1, 1000000 / count));
    std::cout << "Pre-generated sample count: " << count << "\n";
    std::mt19937_64 rng(17171); std::vector<Sample> samples(count);
    std::array<poker::Card, 52> deck; std::iota(deck.begin(), deck.end(), 0);
    for (auto& s : samples) {
        for (unsigned j = 0; j < 9; ++j) {
            unsigned k = std::uniform_int_distribution<unsigned>(j, 51)(rng);
            std::swap(deck[j], deck[k]); s.cards[j] = deck[j];
        }
        s.hole = poker::prepare_hole(poker::Game::Omaha8, s.cards.data() + 5);
        s.board = poker::prepare_board(poker::Game::Omaha8, s.cards.data());
    }
    bench("holdem_reference_7", samples, repeats, [](const auto& s) { return poker::evaluate_high_reference(s.cards.data(), 7); });
    bench("holdem_compact_7", samples, repeats, [](const auto& s) { return poker::evaluate_high(s.cards.data(), 7); });
    bench("omaha_reference_60", samples, repeats, [](const auto& s) {
        uint32_t best = 0; poker::Card five[5];
        for (unsigned a = 5; a < 8; ++a) for (unsigned b = a + 1; b < 9; ++b) {
            five[0] = s.cards[a]; five[1] = s.cards[b];
            for (unsigned x = 0; x < 3; ++x) for (unsigned y = x + 1; y < 4; ++y)
                for (unsigned z = y + 1; z < 5; ++z) {
                    five[2] = s.cards[x]; five[3] = s.cards[y]; five[4] = s.cards[z];
                    best = std::max(best, poker::evaluate_high_reference(five, 5));
                }
        }
        return best;
    });
    bench("omaha_direct_from_cards", samples, repeats, [](const auto& s) {
        return poker::evaluate_prepared(poker::Game::Omaha,
            poker::prepare_hole(poker::Game::Omaha, s.cards.data() + 5),
            poker::prepare_board(poker::Game::Omaha, s.cards.data())).high;
    });
    bench("omaha_direct_prepared", samples, repeats, [](const auto& s) {
        return poker::evaluate_prepared(poker::Game::Omaha, s.hole, s.board).high;
    });
    bench("omaha8_direct_from_cards", samples, repeats, [](const auto& s) {
        auto v = poker::evaluate_prepared(poker::Game::Omaha8,
            poker::prepare_hole(poker::Game::Omaha8, s.cards.data() + 5),
            poker::prepare_board(poker::Game::Omaha8, s.cards.data()));
        return uint64_t(v.high) + v.low;
    });
}
