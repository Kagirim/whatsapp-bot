
export interface Poll {
    pollId: string;
    question: string;
    votes: Vote[];
}

export interface Vote {
    name: string;
    voters: string[];
}