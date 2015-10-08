var fs = require("fs");
var request = require('request');
var GooglePlaces = require("googleplaces");
var Crawler = require("simplecrawler");
var verifier = require('email-verify');
var MongoClient = require('mongodb').MongoClient;

var ParseJobs;

module.exports = function(filename, keyword, locationString, radius, jobId, callback) {
    MongoClient.connect(process.env.MONGO_URL, function(err, db) {
      mongoDb = db;

      ParseJobs = db.collection("parseJobs");
      Users = db.collection("users");

      googleExtract(filename, keyword, locationString, radius, jobId, function(leads) {
          step2(leads);
      });

    });


    function step2(leads) {
        setTmpLeadCount( jobId, leads.length );

        siteParser(leads, jobId, function(fullLeads) {
            step3(fullLeads);
        });
    }

    function step3(fullLeads) {
        var out = "";
        fullLeads.forEach(function(lead) {
            if (lead.emails.length) {
                out += '"' + keyword + '", "' + locationString + '", "' + lead.name + '", "' + lead.emails.join(",") + '", "' + lead.website + '", "' + lead.formatted_phone_number + '", "' + lead.formatted_address + '", "' + lead.rating + '"\n';
            }
        })
        callback(out);
        mongoDb.close();
    }
}

function googleExtract(outFile, keyword, locationString, radius, jobId, callback) {
    if (!outFile || !keyword || !locationString) {
        process.exit();
    }

    GOOGLE_PLACES_API_KEY = "AIzaSyD8s_UOtBNwIyDuk47XfoRDz8BaQvkuqn0"
    GOOGLE_PLACES_OUTPUT_FORMAT = "json"

    var googlePlaces = new GooglePlaces(GOOGLE_PLACES_API_KEY, GOOGLE_PLACES_OUTPUT_FORMAT);
    var counter = 0;
    var leads = [];
    var refs = [];
    var detailIndex = 0;
    var location;
    var balance = 0;

    getUserBalance( jobId, function (res) {
        balance = res.profile.balance;
    })

    request.post({
        url: "https://maps.googleapis.com/maps/api/geocode/json?address=" + locationString + "&key=" + GOOGLE_PLACES_API_KEY
    }, function(error, response, body) {
        response = JSON.parse(body);
        location = [response.results[0].geometry.location.lat, response.results[0].geometry.location.lng]
        findPlaces();
    });

    function findPlaces(next_page_token) {
        if (counter > 1000) {
            return;
        }

        var parameters = {
            location: location,
            keyword: keyword,
            radius: radius
        };

        if (next_page_token) {
            parameters.pagetoken = next_page_token;
        }

        googlePlaces.radarSearch(parameters, function(error, response) {
            if (error) throw error;
            for (i in response.results) {
                refs.push(response.results[i].reference)
            }

            // if (response.next_page_token && (balance*3)> refs.length ) {
            if (response.next_page_token) {
                setTimeout(function() {
                    findPlaces(response.next_page_token);
                }, 5000)
            } else {
                setTimeout(function() {
                    nextDetail();
                }, 1000)
            }

        });
    }


    function nextDetail() {
        if (refs.length < detailIndex + 1) {
            callback(leads);
            return;
        }
        getDetails(refs[detailIndex])
        detailIndex++;
    }


    function getDetails(reference) {
        googlePlaces.placeDetailsRequest({
            reference: reference
        }, function(error, response) {
            if (error) throw error;
            if ( !response.result ) {

            } else {
                if (response.result.website) {
                    var lead = {
                        name: response.result.name,
                        website: response.result.website,
                        formatted_phone_number: response.result.formatted_phone_number,
                        formatted_address: response.result.formatted_address,
                        rating: response.result.rating,
                    };

                    leads.push(lead);
                    // var percent = Math.round((detailIndex / refs.length) * 100)

                    counter++;
                }
            }
            
            nextDetail();
        });
    }
}

function siteParser(leads, jobId, callback) {
    var lastTime;
    var fullLeads = [];
    var count = 0;
    var myInterval;
    var crawler;

    parseNext();

    function parseNext() {
        clearTimeout(myInterval);

        if (leads.length < count + 1) {
            var json = JSON.stringify(fullLeads);
            callback(fullLeads);
            return;
        }
        var parseEmails = [];

        function validateEmails( emails, callback ) {
            var validateCount = 0;
            var validEmails = [];

            function validateNext() {
                if ( validateCount+1 > emails.length ) {
                    callback(validEmails);
                    return;
                }

                verifier.verify( emails[validateCount], {timeout:10000},function( err, info ){
                  if( err ) {
                    // console.log("false")
                  }
                  else{
                    if (info.success) {
                        validEmails.push( emails[validateCount] );
                    } else {
                        // console.log("false")
                    }
                  }

                  validateCount++;
                  validateNext();
                });

            }

            validateNext();
            
        }

        function finishedSite() {
            
            incrementTmpLeadCount(jobId);

            
            if ( count+1 > leads.length || parseEmails.length<1 ) {
                count++;
                clearTimeout(myInterval);
                parseNext();
                return;
            }


            validateEmails(parseEmails, function (validEmails2) {
                if ( leads[count] == undefined ) {
                    count++;
                    clearTimeout(myInterval);

                    setTimeout(function() {
                        delete crawler;
                        parseNext();
                    }, 1000)

                    return;
                }

                var tmpLead = {
                    name: leads[count].name,
                    emails: validEmails2,
                    website: leads[count].website,
                    formatted_phone_number: leads[count].formatted_phone_number,
                    formatted_address: leads[count].formatted_address,
                    rating: leads[count].rating
                };

                getUserBalance( jobId, function (user) {
                    var limit = user.profile.balance;

                    if ( validEmails2.length ) {

                        
                        if (limit>0) {
                            fullLeads.push(tmpLead);

                            ParseJobs.update({
                                _id:jobId
                            }, {
                                $push: {
                                    leads: tmpLead
                                },
                                $inc: {
                                    leadCount: 1
                                }
                            });

                            decreaseBalance(jobId);
                        } else {
                            ParseJobs.update({
                                _id:jobId
                            }, {
                                $push: {
                                    unpaid: tmpLead
                                },
                                $inc: {
                                    unpaidCount: 1
                                }
                            });
                        }


                    }
                    
                    count++;

                    // var percent = Math.round((count / leads.length) * 100);

                    clearTimeout(myInterval);

                    setTimeout(function() {
                        delete crawler;
                        parseNext();
                    }, 1000)
                });

                
            });

        }

        myInterval = setTimeout(function() {
            crawler.stop();

            finishedSite();
        }, 30000)

        crawler = Crawler.crawl(leads[count].website)
            .on("fetchcomplete", function(queueItem, buf, response) {
                var html = buf.toString();

                var tmpEmails = (html.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi) || []);

                if (tmpEmails.length) {
                    parseEmails = parseEmails.concat(tmpEmails);
                }

                parseEmails = parseEmails.getUnique();
            })
            .on("complete", function() {
                clearTimeout( myInterval );
                finishedSite();
            })
            .on("fetchtimeout", function(queueItem) {
                // console.log(queueItem.url + " - timeout")
            })
            .on("fetchclienterror", function(queueItem) {
                // console.log(queueItem.url + " - clienterror")
            })
            .on("fetchdataerror", function(queueItem) {
                // console.log(queueItem.url + " - dataerror")
            })
            .on("fetch404", function(queueItem) {
                // console.log(queueItem.url + " - 404")
            })
            .on("fetcherror", function(queueItem) {
                // console.log(queueItem.url + " - fetcherror")
            });


        crawler.maxDepth = 2;
        crawler.maxConcurrency = 10;
        crawler.downloadUnsupported = false;
        // crawler.listenerTTL = 2000;
        // crawler.timeout = 2000;
        // crawler.scanSubdomains  = true;
        // crawler.ignoreWWWDomain  = false;
        // crawler.userAgent = "Mozilla/5.0";
        // crawler.interval = 1000; // Ten seconds

        var conditionID = crawler.addFetchCondition(function(parsedURL) {
            return !parsedURL.path.match(/\.(js|jpg|gif|jpeg|bmp|css|png|xml|pdf)/i);
            // return parsedURL.path.match(/contact/i);
        });
    }

    Array.prototype.getUnique = function() {
        var u = {},
            a = [];
        for (var i = 0, l = this.length; i < l; ++i) {
            if (u.hasOwnProperty(this[i])) {
                continue;
            }
            a.push(this[i]);
            u[this[i]] = 1;
        }
        return a;
    }
}

function getUserBalance (jobId, callback) {
    ParseJobs.findOne({
      _id: jobId
    }, {
      fields: {
          userId: 1
      }
    }, getUserInfo);

    function getUserInfo (err, result) {
      if ( !err ) {
          var user = Users.findOne({
              _id: result.userId
          }, {
            fields: {
                profile:1
            }
          }, function (err, res) {
            callback(res)
          });

      }
    }
}

function setTmpLeadCount(jobId, count) {
    ParseJobs.update({
        _id: jobId
    }, {
        $set: {
            tmpLeadCount: count
        }
    });
}

function incrementTmpLeadCount(jobId) {
    ParseJobs.update({
        _id: jobId
    }, {
        $inc: {
            tmpLeadIndex: 1
        }
    });
}

function decreaseBalance(jobId) {
    ParseJobs.findOne({
      _id: jobId
    }, {
      fields: {
          userId: 1
      }
    }, decreaseUserBalance);

    function decreaseUserBalance (err, result) {
      if ( !err ) {
          var user = Users.update({
              _id: result.userId
          }, {
            $inc: {
                "profile.balance": -1
            }
          });

      }
    }
}