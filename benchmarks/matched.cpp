#include "fast_eval.hpp"
#include <chrono>
#include <fstream>
#include <iostream>
#include <iterator>

using Clock = std::chrono::steady_clock;
template<class F> void bench(const char* name, size_t count, size_t repeats, F f) {
    uint64_t checksum = 0;
    auto start = Clock::now();
    for (size_t n = 0; n < repeats; ++n) for (size_t i = 0; i < count; ++i) checksum += f(i);
    double seconds = std::chrono::duration<double>(Clock::now() - start).count();
    std::cout << name << " " << count * repeats / seconds << " " << checksum << "\n";
}
int main(int argc, char** argv) {
    if (argc != 4) return 2;
    std::ifstream in(argv[1], std::ios::binary);
    std::vector<uint8_t> data((std::istreambuf_iterator<char>(in)), {});
    size_t count = std::stoull(argv[2]), repeats = std::stoull(argv[3]);
    if (!count || !repeats || data.size() < count * 9) return 2;
    poker::initialize_omaha_table();
    std::vector<poker::FastHole> he_holes, om_holes;
    std::vector<poker::FastBoard> he_boards, om_boards;
    std::vector<omp::Hand> omp_hands;
    std::vector<std::vector<poker::Card>> holes, boards;
    for (size_t i = 0; i < count; ++i) {
        auto c = data.data() + i * 9;
        he_holes.push_back(poker::prepare_hole(poker::Game::Holdem, c + 5));
        he_boards.push_back(poker::prepare_board(poker::Game::Holdem, c));
        om_holes.push_back(poker::prepare_hole(poker::Game::Omaha8, c + 5));
        om_boards.push_back(poker::prepare_board(poker::Game::Omaha8, c));
        omp_hands.push_back(he_holes.back().high + he_boards.back().high);
        holes.emplace_back(c + 5, c + 9); boards.emplace_back(c, c + 5);
    }
    bench("holdem_checked",count,repeats,[&](size_t i){return poker::evaluate_high(data.data()+i*9,7);});
    bench("holdem_prepared",count,repeats,[&](size_t i){return poker::evaluate_prepared(poker::Game::Holdem,he_holes[i],he_boards[i]).high;});
    bench("omp_prepared",count,repeats,[&](size_t i){return poker::fast_evaluator().evaluate(omp_hands[i]);});
    bench("omaha_checked",count,repeats,[&](size_t i){return poker::evaluate(poker::Game::Omaha,holes[i],boards[i]).high;});
    bench("omaha_prepared",count,repeats,[&](size_t i){return poker::evaluate_prepared(poker::Game::Omaha,om_holes[i],om_boards[i]).high;});
    bench("omaha8_checked",count,repeats,[&](size_t i){auto v=poker::evaluate(poker::Game::Omaha8,holes[i],boards[i]);return uint64_t(v.high)+v.low;});
}
