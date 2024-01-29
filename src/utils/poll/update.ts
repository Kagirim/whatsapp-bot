
import { PollRepository } from '../db/repository';


export async function updatePoll(pollRepository: PollRepository, pollId: string, question: string, votes: any[]) {
    const res = await pollRepository.update({
        pollId,
        question,
        votes
    });
}