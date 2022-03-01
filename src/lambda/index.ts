import { DynamoDB } from '@aws-sdk/client-dynamodb';
import { 
    APIGatewayProxyEvent,
    APIGatewayProxyResult,
} from 'aws-lambda';

import axios from 'axios';

const FRC_BASE_URL = 'https://frc-api.firstinspires.org/v2.0';
const FRC_EVENT_KEY_REGEX = /(\d{4})([a-z]+)/;

enum FIRSTPrograms {
    FRC = 'FRC',
    FTC = 'FTC',
}

declare global {
    interface APIGatewayProxyEventPathParameters {
        program: FIRSTPrograms
        eventKey: string
    }
}

// TODO: refactor
interface Match {
    startTime: string
    teams: object[]
    scoreRedFinal?: number
    scoreBlueFinal?: number
    matchId: string
}

export const handler = async (
    event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
    const program = event.pathParameters!.program!.toUpperCase();
    const eventKey = event.pathParameters!.eventKey!;

    console.log(`Handling request for ${program} ${eventKey}`);

    const isProgramValid = Object.keys(FIRSTPrograms).filter(p => program == p).length > 0;
    if (!isProgramValid) {
        console.error('Invalid program');
        return {
            statusCode: 400,
            body: JSON.stringify({
                error: 'Invalid program',
            }),
        };
    }

    if (program == FIRSTPrograms.FRC) {
        if (!FRC_EVENT_KEY_REGEX.test(eventKey)) {
            console.error('Invalid FRC event key');
            return {
                statusCode: 400,
                body: JSON.stringify({
                    error: 'Invalid event key',
                }),
            };
        }
    }

    console.log('Reading DynamoDB');
    const ddb = new DynamoDB({});
    const existingResults = await ddb.query({
        TableName: process.env.TABLE_NAME,
        KeyConditionExpression: '#eventKey = :eventKey',
        ExpressionAttributeNames: {
            '#eventKey': 'EventKey',
        },
        ExpressionAttributeValues: {
            ':eventKey': {
                'S': eventKey!
            },
        },
    });

    if (existingResults.Count && existingResults.Count > 0) {
        console.log('Results found, returning');
        return {
            statusCode: 200,
            body: JSON.stringify(existingResults.Items),
        };
    } else {
        console.log('No results found, fetching fresh data');
        // TODO: this should only be done once.
        //       invoke a lambda and repeat get until fulfilled?
        if (program == FIRSTPrograms.FRC) {
            const matches = eventKey.match(FRC_EVENT_KEY_REGEX)!;
            const year = matches[1];
            const eventId = matches[2];
            console.log('Creating GET requests to FRC API');
            const promises = ['Qualification', 'Playoff'].map(level => 
                axios.get(FRC_BASE_URL + `/${year}/schedule/${eventId}/${level}/hybrid`, {
                    headers: {
                        'Authorization': `Basic ${process.env.FRC_API_KEY}`,
                        'If-Modified-Since': '',
                    },
                }));
            const [quals, elims] = (await axios.all(promises)).map(x => x.data);
            console.log('GET requests fulfilled');
            const matchSchedule = quals.Schedule.concat(elims.Schedule);
            const matchObjects: Match[] = matchSchedule.map((match: any) => ({  // TODO: any bad
                startTime: match.startTime,
                teams: match.teams,
                scoreRedFinal: match.scoreRedFinal,
                scoreBlueFinal: match.scoreBlueFinal,
                matchId: (
                    match.tournamentLevel == 'Playoff' ?
                        (match.description.startsWith('Quarterfinal') ? 'qf'
                            : (match.description.startsWith('Semifinal') ? 'sf' : 'f'))
                    : 'q') + match.description.match(/(\d+)/g)[0],
            }));
            console.log('Start write to DynamoDB...');
            const writeRequests = matchObjects.map(match => {
                let request = {
                    PutRequest: {
                        Item: {
                            EventKey: {
                                S: eventKey,
                            },
                            MatchId: {
                                S: match.matchId
                            },
                            StartTime: {
                                S: match.startTime
                            },
                            Teams: {
                                L: match.teams.map(team => ({ S: JSON.stringify(team) })),
                            },
                        }
                    }
                };
                if (match.scoreRedFinal != undefined && match.scoreBlueFinal != undefined) {
                    // TODO: this is jank
                    (request.PutRequest.Item as any)['ScoreRedFinal'] = {
                        N: match.scoreRedFinal.toString()
                    };
                    (request.PutRequest.Item as any)['ScoreBlueFinal'] = {
                        N: match.scoreBlueFinal.toString()
                    };
                }
                return request;
            });
            let writePromises = [];
            for (let i = 0; i < writeRequests.length; i += 25) {
                writePromises.push(ddb.batchWriteItem({
                    RequestItems: {
                        [process.env.TABLE_NAME!]: writeRequests.slice(i, i + 25),
                    }
                }));
            }
            await Promise.all(writePromises)
                .catch(err => console.error(`Failed to write to DDB [${eventKey}]: ${err}`));
            console.log('Done!');
            return {
                statusCode: 200,
                body: JSON.stringify(matchObjects),
            }
        } else {
            console.warn('Fetching fresh data not implemented yet.');
            return {
                statusCode: 501,
                body: JSON.stringify({
                    error: 'Not implemented',
                }),
            };
        }
    }
};
